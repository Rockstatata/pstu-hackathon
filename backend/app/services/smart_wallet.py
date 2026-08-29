"""Physical-cash inventory for the Smart Wallet.

Cash observations never call the Transfer engine and never write Journal Entries.
They append to their own inventory journal, then update the cached Expected Cash
projection in the same short PostgreSQL transaction (ADR-0008).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import set_lock_timeout
from ..errors import DomainError
from . import ledger


def _select_wallet(session: Session, user_id: uuid.UUID, *, lock: bool = False):
    suffix = " FOR UPDATE" if lock else ""
    row = session.execute(
        text(
            "SELECT id, user_id, expected_cash_poisha, connection_status, "
            "last_sequence, last_synced_at, created_at, updated_at "
            "FROM smart_wallets WHERE user_id = :uid" + suffix
        ),
        {"uid": user_id},
    ).one_or_none()
    if row is None:
        raise DomainError(
            "SMART_WALLET_UNAVAILABLE",
            "Your Smart Wallet could not be loaded.",
            503,
        )
    return row


def _event_resource(row) -> dict:
    return {
        "eventId": str(row.id),
        "sequenceNumber": row.sequence_number,
        "kind": row.kind,
        "amountPoisha": row.amount_poisha,
        "expectedBeforePoisha": row.expected_before_poisha,
        "expectedAfterPoisha": row.expected_after_poisha,
        "countedCashPoisha": row.counted_cash_poisha,
        "source": row.source,
        "reason": row.reason,
        "observedAt": row.observed_at.isoformat(),
        "recordedAt": row.created_at.isoformat(),
    }


def get(session: Session, user_id: uuid.UUID, *, limit: int = 25) -> dict:
    wallet = _select_wallet(session, user_id)
    rows = session.execute(
        text(
            "SELECT id, sequence_number, kind, amount_poisha, expected_before_poisha, "
            "expected_after_poisha, counted_cash_poisha, source, reason, observed_at, created_at "
            "FROM cash_events WHERE smart_wallet_id = :wid "
            "ORDER BY sequence_number DESC LIMIT :limit"
        ),
        {"wid": wallet.id, "limit": limit},
    ).all()
    event_sum = session.execute(
        text(
            "SELECT COALESCE(SUM(amount_poisha), 0) FROM cash_events "
            "WHERE smart_wallet_id = :wid"
        ),
        {"wid": wallet.id},
    ).scalar_one()
    # PostgreSQL SUM(bigint) returns numeric. Normalize it back to Python int so
    # the first response and its JSONB idempotent replay are byte-for-byte equal.
    difference = wallet.expected_cash_poisha - int(event_sum)
    return {
        "walletId": str(wallet.id),
        "connectionStatus": wallet.connection_status,
        "expectedCashPoisha": wallet.expected_cash_poisha,
        "lastSequence": wallet.last_sequence,
        "lastSyncedAt": wallet.last_synced_at.isoformat() if wallet.last_synced_at else None,
        "inventoryDifferencePoisha": difference,
        "activity": [_event_resource(row) for row in rows],
    }


def set_connection(
    session: Session,
    *,
    user_id: uuid.UUID,
    connected: bool,
) -> dict:
    set_lock_timeout(session)
    wallet = _select_wallet(session, user_id, lock=True)
    target = "CONNECTED" if connected else "DISCONNECTED"
    if wallet.connection_status != target:
        session.execute(
            text(
                "UPDATE smart_wallets SET connection_status = :status, "
                "last_synced_at = CASE WHEN :connected THEN now() ELSE last_synced_at END, "
                "updated_at = now() WHERE id = :wid"
            ),
            {"status": target, "connected": connected, "wid": wallet.id},
        )
        ledger.audit(
            session,
            "SMART_WALLET_" + target,
            actor_user_id=user_id,
            resource_type="smart_wallet",
            resource_id=wallet.id,
        )
    return get(session, user_id)


def _append_event(
    session: Session,
    *,
    wallet,
    external_event_id: str,
    kind: str,
    amount_poisha: int,
    counted_cash_poisha: int | None,
    source: str,
    reason: str | None,
) -> tuple[uuid.UUID, dict]:
    expected_before = wallet.expected_cash_poisha
    expected_after = expected_before + amount_poisha
    if expected_after < 0:
        raise DomainError(
            "CASH_INVENTORY_INSUFFICIENT",
            "Expected Cash is lower than that cash-out amount. Count and reconcile the wallet first.",
            409,
        )

    event_id = uuid.uuid4()
    sequence_number = wallet.last_sequence + 1
    observed_at = datetime.now(timezone.utc)
    session.execute(
        text(
            "INSERT INTO cash_events "
            "(id, smart_wallet_id, external_event_id, sequence_number, kind, amount_poisha, "
            "expected_before_poisha, expected_after_poisha, counted_cash_poisha, source, "
            "reason, observed_at, created_at) VALUES "
            "(:id, :wid, :external, :sequence, :kind, :amount, :before, :after, "
            ":counted, :source, :reason, :observed, :observed)"
        ),
        {
            "id": event_id,
            "wid": wallet.id,
            "external": external_event_id,
            "sequence": sequence_number,
            "kind": kind,
            "amount": amount_poisha,
            "before": expected_before,
            "after": expected_after,
            "counted": counted_cash_poisha,
            "source": source,
            "reason": reason,
            "observed": observed_at,
        },
    )
    session.execute(
        text(
            "UPDATE smart_wallets SET expected_cash_poisha = :expected, "
            "last_sequence = :sequence, last_synced_at = now(), updated_at = now() "
            "WHERE id = :wid"
        ),
        {"expected": expected_after, "sequence": sequence_number, "wid": wallet.id},
    )
    event = {
        "eventId": str(event_id),
        "sequenceNumber": sequence_number,
        "kind": kind,
        "amountPoisha": amount_poisha,
        "expectedBeforePoisha": expected_before,
        "expectedAfterPoisha": expected_after,
        "countedCashPoisha": counted_cash_poisha,
        "source": source,
        "reason": reason,
        "observedAt": observed_at.isoformat(),
        "recordedAt": observed_at.isoformat(),
    }
    return event_id, event


def record_observation(
    session: Session,
    *,
    user_id: uuid.UUID,
    kind: str,
    amount_poisha: int,
    reason: str | None,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    record_id = idem.reserve(
        session, user_id, idempotency_key, request_hash, "cash_event"
    )
    wallet = _select_wallet(session, user_id, lock=True)
    if wallet.connection_status != "CONNECTED":
        raise DomainError(
            "SMART_WALLET_DISCONNECTED",
            "Connect the Smart Wallet before simulating a cash event.",
            409,
        )

    signed_amount = amount_poisha if kind == "CASH_IN" else -amount_poisha
    event_id, event = _append_event(
        session,
        wallet=wallet,
        external_event_id=idempotency_key,
        kind=kind,
        amount_poisha=signed_amount,
        counted_cash_poisha=None,
        source="SIMULATOR",
        reason=reason,
    )
    ledger.audit(
        session,
        "SMART_WALLET_" + kind,
        actor_user_id=user_id,
        resource_type="cash_event",
        resource_id=event_id,
        metadata={"amountPoisha": signed_amount, "sequenceNumber": event["sequenceNumber"]},
    )
    body = {"event": event, "wallet": get(session, user_id)}
    idem.finalize(session, record_id, event_id, 201, body)
    return 201, body


def reconcile(
    session: Session,
    *,
    user_id: uuid.UUID,
    counted_cash_poisha: int,
    reason: str,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    record_id = idem.reserve(
        session, user_id, idempotency_key, request_hash, "cash_reconciliation"
    )
    wallet = _select_wallet(session, user_id, lock=True)
    discrepancy = counted_cash_poisha - wallet.expected_cash_poisha
    event_id, event = _append_event(
        session,
        wallet=wallet,
        external_event_id=idempotency_key,
        kind="RECONCILIATION",
        amount_poisha=discrepancy,
        counted_cash_poisha=counted_cash_poisha,
        source="USER",
        reason=reason,
    )
    ledger.audit(
        session,
        "CASH_COUNT_RECONCILED",
        actor_user_id=user_id,
        resource_type="cash_event",
        resource_id=event_id,
        metadata={
            "expectedBeforePoisha": event["expectedBeforePoisha"],
            "countedCashPoisha": counted_cash_poisha,
            "discrepancyPoisha": discrepancy,
        },
    )
    body = {"event": event, "wallet": get(session, user_id)}
    idem.finalize(session, record_id, event_id, 201, body)
    return 201, body
