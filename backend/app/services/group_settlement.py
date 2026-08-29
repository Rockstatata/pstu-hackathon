"""Shared-expense accounting and consent-preserving settlement.

Expenses and Shares describe obligations but never move money. A Settlement Plan
is recomputed from immutable accounting rows. Only the signed-in payer's outgoing
instructions are passed to transfer.execute(), so the existing money path remains
the sole authority (ADR-0009).
"""

import hashlib
import json
import secrets
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import idempotency as idem
from ..db import set_lock_timeout
from ..errors import DomainError
from . import ledger, transfer

_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_reference() -> str:
    return "GRP" + "".join(secrets.choice(_REF_ALPHABET) for _ in range(11))


def _parse_user_id(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise DomainError("GROUP_MEMBER_NOT_FOUND", "That group member no longer exists.", 404) from exc


def _group_row(
    session: Session,
    group_id: uuid.UUID,
    viewer_user_id: uuid.UUID,
    *,
    lock: bool = False,
):
    suffix = " FOR UPDATE OF eg" if lock else ""
    row = session.execute(
        text(
            "SELECT eg.id, eg.name, eg.created_by_user_id, eg.created_at "
            "FROM expense_groups eg "
            "JOIN expense_group_members gm ON gm.group_id = eg.id "
            "WHERE eg.id = :gid AND gm.user_id = :viewer" + suffix
        ),
        {"gid": group_id, "viewer": viewer_user_id},
    ).one_or_none()
    if row is None:
        raise DomainError("EXPENSE_GROUP_NOT_FOUND", "No expense group found with that ID.", 404)
    return row


def _members(session: Session, group_id: uuid.UUID, viewer_user_id: uuid.UUID):
    return session.execute(
        text(
            "SELECT u.id, u.name, u.phone, gm.joined_at "
            "FROM expense_group_members gm JOIN users u ON u.id = gm.user_id "
            "WHERE gm.group_id = :gid ORDER BY u.name, u.id"
        ),
        {"gid": group_id},
    ).all()


def _member_resource(row, viewer_user_id: uuid.UUID) -> dict:
    return {
        "userId": str(row.id),
        "name": row.name,
        "maskedPhone": transfer.mask_phone(row.phone),
        "isCurrentUser": row.id == viewer_user_id,
    }


def create_group(
    session: Session,
    *,
    creator_user_id: uuid.UUID,
    creator_phone: str,
    name: str,
    member_phones: list[str],
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    record_id = idem.reserve(
        session, creator_user_id, idempotency_key, request_hash, "expense_group"
    )
    phones = sorted(set(member_phones) - {creator_phone})
    rows = session.execute(
        text(
            "SELECT id, phone FROM users WHERE phone = ANY(:phones) AND is_system = FALSE"
        ),
        {"phones": phones},
    ).all() if phones else []
    if len(rows) != len(phones):
        raise DomainError(
            "GROUP_MEMBER_NOT_FOUND",
            "One or more group members are not registered with Chorui.",
            404,
        )

    group_id = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO expense_groups (id, name, created_by_user_id) "
            "VALUES (:id, :name, :creator)"
        ),
        {"id": group_id, "name": name, "creator": creator_user_id},
    )
    member_ids = [creator_user_id, *(row.id for row in rows)]
    session.execute(
        text("INSERT INTO expense_group_members (group_id, user_id) VALUES (:gid, :uid)"),
        [{"gid": group_id, "uid": member_id} for member_id in member_ids],
    )
    body = get_group(session, group_id, creator_user_id)
    ledger.audit(
        session,
        "EXPENSE_GROUP_CREATED",
        actor_user_id=creator_user_id,
        resource_type="expense_group",
        resource_id=group_id,
        metadata={"memberCount": len(member_ids)},
    )
    idem.finalize(session, record_id, group_id, 201, body)
    return 201, body


def list_groups(session: Session, viewer_user_id: uuid.UUID) -> dict:
    rows = session.execute(
        text(
            "SELECT eg.id, eg.name, eg.created_at, COUNT(DISTINCT members.user_id) AS member_count, "
            "COUNT(DISTINCT expenses.id) AS expense_count "
            "FROM expense_group_members mine "
            "JOIN expense_groups eg ON eg.id = mine.group_id "
            "JOIN expense_group_members members ON members.group_id = eg.id "
            "LEFT JOIN group_expenses expenses ON expenses.group_id = eg.id "
            "WHERE mine.user_id = :viewer "
            "GROUP BY eg.id, eg.name, eg.created_at "
            "ORDER BY eg.created_at DESC, eg.id DESC"
        ),
        {"viewer": viewer_user_id},
    ).all()
    return {
        "groups": [
            {
                "groupId": str(row.id),
                "name": row.name,
                "memberCount": row.member_count,
                "expenseCount": row.expense_count,
                "createdAt": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


def get_group(session: Session, group_id: uuid.UUID, viewer_user_id: uuid.UUID) -> dict:
    group = _group_row(session, group_id, viewer_user_id)
    members = _members(session, group_id, viewer_user_id)
    expenses = session.execute(
        text(
            "SELECT ge.id, ge.description, ge.total_poisha, ge.split_type, ge.created_at, "
            "payer.id AS payer_id, payer.name AS payer_name, payer.phone AS payer_phone "
            "FROM group_expenses ge JOIN users payer ON payer.id = ge.paid_by_user_id "
            "WHERE ge.group_id = :gid ORDER BY ge.created_at DESC, ge.id DESC"
        ),
        {"gid": group_id},
    ).all()
    expense_ids = [row.id for row in expenses]
    share_rows = session.execute(
        text(
            "SELECT ges.expense_id, ges.amount_poisha, u.id, u.name, u.phone "
            "FROM group_expense_shares ges JOIN users u ON u.id = ges.user_id "
            "WHERE ges.expense_id = ANY(:ids) ORDER BY ges.expense_id, u.name, u.id"
        ),
        {"ids": expense_ids},
    ).all() if expense_ids else []
    shares_by_expense: dict[uuid.UUID, list[dict]] = {}
    for share in share_rows:
        shares_by_expense.setdefault(share.expense_id, []).append(
            {
                "member": _member_resource(share, viewer_user_id),
                "amountPoisha": share.amount_poisha,
            }
        )

    return {
        "groupId": str(group.id),
        "name": group.name,
        "createdAt": group.created_at.isoformat(),
        "members": [_member_resource(row, viewer_user_id) for row in members],
        "expenses": [
            {
                "expenseId": str(row.id),
                "description": row.description,
                "totalPoisha": row.total_poisha,
                "splitType": row.split_type,
                "paidBy": {
                    "userId": str(row.payer_id),
                    "name": row.payer_name,
                    "maskedPhone": transfer.mask_phone(row.payer_phone),
                    "isCurrentUser": row.payer_id == viewer_user_id,
                },
                "shares": shares_by_expense.get(row.id, []),
                "createdAt": row.created_at.isoformat(),
            }
            for row in expenses
        ],
    }


def _compute_shares(
    total_poisha: int,
    split_type: str,
    allocations: list[tuple[uuid.UUID, int]],
) -> list[tuple[uuid.UUID, int]]:
    if not allocations:
        raise DomainError("INVALID_EXPENSE_SPLIT", "Choose at least one group member to share this expense.")
    if len({user_id for user_id, _ in allocations}) != len(allocations):
        raise DomainError("INVALID_EXPENSE_SPLIT", "Each group member can appear only once in a split.")

    ordered = sorted(allocations, key=lambda item: str(item[0]))
    if split_type == "EQUAL":
        base, remainder = divmod(total_poisha, len(ordered))
        shares = [
            (user_id, base + (1 if index < remainder else 0))
            for index, (user_id, _) in enumerate(ordered)
        ]
    elif split_type == "EXACT":
        shares = ordered
        if sum(amount for _, amount in shares) != total_poisha:
            raise DomainError("INVALID_EXPENSE_SPLIT", "Exact shares must add up to the expense amount.")
    else:
        if sum(bps for _, bps in ordered) != 10_000:
            raise DomainError("INVALID_EXPENSE_SPLIT", "Percentages must add up to 100%. ")
        calculated = []
        allocated = 0
        for user_id, bps in ordered:
            numerator = total_poisha * bps
            amount, fractional = divmod(numerator, 10_000)
            calculated.append([user_id, amount, fractional])
            allocated += amount
        remainder = total_poisha - allocated
        calculated.sort(key=lambda item: (-item[2], str(item[0])))
        for index in range(remainder):
            calculated[index][1] += 1
        shares = sorted(
            [(item[0], item[1]) for item in calculated], key=lambda item: str(item[0])
        )

    if any(amount <= 0 for _, amount in shares):
        raise DomainError("INVALID_EXPENSE_SPLIT", "Every Expense Share must be at least one poisha.")
    return shares


def create_expense(
    session: Session,
    *,
    group_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    paid_by_user_id: str,
    description: str,
    total_poisha: int,
    split_type: str,
    allocations: list[tuple[str, int]],
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    record_id = idem.reserve(
        session, actor_user_id, idempotency_key, request_hash, "group_expense"
    )
    _group_row(session, group_id, actor_user_id, lock=True)
    member_ids = {
        row.id for row in session.execute(
            text("SELECT user_id AS id FROM expense_group_members WHERE group_id = :gid"),
            {"gid": group_id},
        ).all()
    }
    payer_id = _parse_user_id(paid_by_user_id)
    parsed_allocations = [(_parse_user_id(user_id), value) for user_id, value in allocations]
    involved = {payer_id, *(user_id for user_id, _ in parsed_allocations)}
    if not involved.issubset(member_ids):
        raise DomainError("GROUP_MEMBER_NOT_FOUND", "Every payer and participant must belong to this group.", 404)
    shares = _compute_shares(total_poisha, split_type, parsed_allocations)

    expense_id = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO group_expenses "
            "(id, group_id, paid_by_user_id, created_by_user_id, description, total_poisha, split_type) "
            "VALUES (:id, :gid, :payer, :creator, :description, :total, :split)"
        ),
        {
            "id": expense_id,
            "gid": group_id,
            "payer": payer_id,
            "creator": actor_user_id,
            "description": description,
            "total": total_poisha,
            "split": split_type,
        },
    )
    session.execute(
        text(
            "INSERT INTO group_expense_shares (expense_id, user_id, amount_poisha) "
            "VALUES (:eid, :uid, :amount)"
        ),
        [{"eid": expense_id, "uid": user_id, "amount": amount} for user_id, amount in shares],
    )
    body = get_group(session, group_id, actor_user_id)
    ledger.audit(
        session,
        "GROUP_EXPENSE_CREATED",
        actor_user_id=actor_user_id,
        resource_type="group_expense",
        resource_id=expense_id,
        metadata={"groupId": group_id, "totalPoisha": total_poisha, "splitType": split_type},
    )
    idem.finalize(session, record_id, expense_id, 201, body)
    return 201, body


def _position_rows(session: Session, group_id: uuid.UUID):
    return session.execute(
        text(
            """
            WITH paid AS (
                SELECT paid_by_user_id AS user_id, SUM(total_poisha) AS amount
                FROM group_expenses WHERE group_id = :gid GROUP BY paid_by_user_id
            ), owed AS (
                SELECT ges.user_id, SUM(ges.amount_poisha) AS amount
                FROM group_expense_shares ges
                JOIN group_expenses ge ON ge.id = ges.expense_id
                WHERE ge.group_id = :gid GROUP BY ges.user_id
            ), sent AS (
                SELECT payer_user_id AS user_id, SUM(amount_poisha) AS amount
                FROM group_settlements WHERE group_id = :gid GROUP BY payer_user_id
            ), received AS (
                SELECT recipient_user_id AS user_id, SUM(amount_poisha) AS amount
                FROM group_settlements WHERE group_id = :gid GROUP BY recipient_user_id
            )
            SELECT u.id, u.name, u.phone,
                   COALESCE(paid.amount, 0) - COALESCE(owed.amount, 0)
                   + COALESCE(sent.amount, 0) - COALESCE(received.amount, 0) AS net_poisha
            FROM expense_group_members gm
            JOIN users u ON u.id = gm.user_id
            LEFT JOIN paid ON paid.user_id = u.id
            LEFT JOIN owed ON owed.user_id = u.id
            LEFT JOIN sent ON sent.user_id = u.id
            LEFT JOIN received ON received.user_id = u.id
            WHERE gm.group_id = :gid
            ORDER BY u.id
            """
        ),
        {"gid": group_id},
    ).all()


def _build_plan(group, rows, viewer_user_id: uuid.UUID) -> tuple[dict, list[dict]]:
    positions = {row.id: int(row.net_poisha) for row in rows}
    if sum(positions.values()) != 0:
        raise DomainError("INTERNAL_ERROR", "The group positions do not balance.", 500)
    by_id = {row.id: row for row in rows}
    debtors = [[user_id, -amount] for user_id, amount in positions.items() if amount < 0]
    creditors = [[user_id, amount] for user_id, amount in positions.items() if amount > 0]
    debtors.sort(key=lambda item: (-item[1], str(item[0])))
    creditors.sort(key=lambda item: (-item[1], str(item[0])))

    transfers = []
    debtor_index = 0
    creditor_index = 0
    while debtor_index < len(debtors) and creditor_index < len(creditors):
        debtor_id, owes = debtors[debtor_index]
        creditor_id, receives = creditors[creditor_index]
        amount = min(owes, receives)
        transfers.append(
            {
                "payerId": debtor_id,
                "recipientId": creditor_id,
                "recipientPhone": by_id[creditor_id].phone,
                "amountPoisha": amount,
            }
        )
        debtors[debtor_index][1] -= amount
        creditors[creditor_index][1] -= amount
        if debtors[debtor_index][1] == 0:
            debtor_index += 1
        if creditors[creditor_index][1] == 0:
            creditor_index += 1

    version_payload = {
        "groupId": str(group.id),
        "positions": [(str(user_id), positions[user_id]) for user_id in sorted(positions, key=str)],
    }
    version = hashlib.sha256(
        json.dumps(version_payload, separators=(",", ":")).encode()
    ).hexdigest()

    def member(user_id: uuid.UUID) -> dict:
        row = by_id[user_id]
        return _member_resource(row, viewer_user_id)

    public_transfers = [
        {
            "from": member(item["payerId"]),
            "to": member(item["recipientId"]),
            "amountPoisha": item["amountPoisha"],
            "isCurrentUserPayer": item["payerId"] == viewer_user_id,
        }
        for item in transfers
    ]
    outgoing = sum(
        item["amountPoisha"] for item in transfers if item["payerId"] == viewer_user_id
    )
    body = {
        "groupId": str(group.id),
        "groupName": group.name,
        "planVersion": version,
        "positions": [
            {
                "member": member(row.id),
                "netPoisha": positions[row.id],
                "direction": "RECEIVE" if positions[row.id] > 0 else "PAY" if positions[row.id] < 0 else "SETTLED",
            }
            for row in rows
        ],
        "transfers": public_transfers,
        "optimizedTransferCount": len(public_transfers),
        "currentUserOutgoingPoisha": outgoing,
        "canCurrentUserSettle": outgoing > 0,
    }
    return body, transfers


def settlement_plan(
    session: Session, group_id: uuid.UUID, viewer_user_id: uuid.UUID
) -> dict:
    group = _group_row(session, group_id, viewer_user_id)
    body, _ = _build_plan(group, _position_rows(session, group_id), viewer_user_id)
    return body


def settle_current_user(
    session: Session,
    *,
    group_id: uuid.UUID,
    payer_user_id: uuid.UUID,
    payer_account_id: uuid.UUID,
    payer_pin_hash: str,
    plan_version: str,
    pin: str | None,
    idempotency_key: str,
    request_hash: str,
) -> tuple[int, dict]:
    set_lock_timeout(session)
    group = _group_row(session, group_id, payer_user_id, lock=True)

    # A duplicate waiting on this group lock must replay the winner before it
    # sees the winner's settlements as a new plan.
    idem.peek(session, payer_user_id, idempotency_key, request_hash)
    plan, internal_transfers = _build_plan(
        group, _position_rows(session, group_id), payer_user_id
    )
    if plan["planVersion"] != plan_version:
        raise DomainError(
            "SETTLEMENT_PLAN_CHANGED",
            "The group changed since this plan was reviewed. Review the updated settlement first.",
            409,
        )
    outgoing = [item for item in internal_transfers if item["payerId"] == payer_user_id]
    if not outgoing:
        raise DomainError("NOTHING_TO_SETTLE", "You do not currently owe a group settlement.", 409)

    result = transfer.execute(
        session,
        sender_user_id=payer_user_id,
        sender_account_id=payer_account_id,
        sender_pin_hash=payer_pin_hash,
        recipients=[
            transfer.Recipient(
                phone=item["recipientPhone"], amount_poisha=item["amountPoisha"]
            )
            for item in outgoing
        ],
        note=f"Settlement for {group.name}",
        pin=pin,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        receipt_context={
            "expenseGroupId": str(group.id),
            "expenseGroupName": group.name,
            "settlementPlanVersion": plan_version,
        },
    )
    transfer_id = uuid.UUID(result[1]["transferId"])
    session.execute(
        text(
            "INSERT INTO group_settlements "
            "(id, group_id, payer_user_id, recipient_user_id, amount_poisha, transfer_id) "
            "VALUES (:id, :gid, :payer, :recipient, :amount, :transfer)"
        ),
        [
            {
                "id": uuid.uuid4(),
                "gid": group_id,
                "payer": payer_user_id,
                "recipient": item["recipientId"],
                "amount": item["amountPoisha"],
                "transfer": transfer_id,
            }
            for item in outgoing
        ],
    )
    ledger.audit(
        session,
        "GROUP_SETTLEMENT_COMPLETED",
        actor_user_id=payer_user_id,
        resource_type="expense_group",
        resource_id=group_id,
        metadata={
            "transferId": transfer_id,
            "planVersion": plan_version,
            "recipientCount": len(outgoing),
        },
    )
    return result
