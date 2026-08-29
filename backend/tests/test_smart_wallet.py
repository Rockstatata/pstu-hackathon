import threading
import unittest
import uuid

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app import idempotency as idem
from app.db import SessionLocal
from app.errors import DomainError
from app.services import smart_wallet


class SmartWalletServiceTests(unittest.TestCase):
    def setUp(self):
        self.session = SessionLocal()
        self.user_id = uuid.uuid4()
        self.other_user_id = uuid.uuid4()
        suffix = str(uuid.uuid4().int)[-8:]
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                "(:first, :first_phone, 'Cash Owner', 'x'), "
                "(:second, :second_phone, 'Other Owner', 'x')"
            ),
            {
                "first": self.user_id,
                "second": self.other_user_id,
                "first_phone": "013" + suffix,
                "second_phone": "014" + suffix,
            },
        )
        self.session.execute(
            text(
                "INSERT INTO smart_wallets (id, user_id, connection_status) VALUES "
                "(:first, :first, 'CONNECTED'), (:second, :second, 'CONNECTED')"
            ),
            {"first": self.user_id, "second": self.other_user_id},
        )

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def _observe(
        self,
        *,
        user_id=None,
        kind="CASH_IN",
        amount=50_000,
        key=None,
    ):
        owner = user_id or self.user_id
        payload = {"kind": kind, "amountPoisha": amount}
        return smart_wallet.record_observation(
            self.session,
            user_id=owner,
            kind=kind,
            amount_poisha=amount,
            reason=None,
            idempotency_key=key or uuid.uuid4().hex,
            request_hash=idem.hash_request(payload),
        )

    def test_cash_events_update_only_cash_inventory_and_preserve_digital_ledger(self):
        ledger_before = self.session.execute(
            text("SELECT COALESCE(SUM(amount_poisha), 0) FROM journal_entries")
        ).scalar_one()

        status, result = self._observe(amount=100_000)
        self._observe(kind="CASH_OUT", amount=25_000)

        wallet = smart_wallet.get(self.session, self.user_id)
        ledger_after = self.session.execute(
            text("SELECT COALESCE(SUM(amount_poisha), 0) FROM journal_entries")
        ).scalar_one()
        self.assertEqual(status, 201)
        self.assertEqual(result["event"]["source"], "SIMULATOR")
        self.assertEqual(wallet["expectedCashPoisha"], 75_000)
        self.assertEqual(wallet["inventoryDifferencePoisha"], 0)
        self.assertEqual(ledger_after, ledger_before)

    def test_reconciliation_is_an_explicit_append_only_event(self):
        self._observe(amount=100_000)
        payload = {"countedCashPoisha": 82_500, "reason": "Counted banknotes"}
        _, result = smart_wallet.reconcile(
            self.session,
            user_id=self.user_id,
            counted_cash_poisha=82_500,
            reason="Counted banknotes",
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request(payload),
        )

        event = result["event"]
        self.assertEqual(event["kind"], "RECONCILIATION")
        self.assertEqual(event["expectedBeforePoisha"], 100_000)
        self.assertEqual(event["countedCashPoisha"], 82_500)
        self.assertEqual(event["amountPoisha"], -17_500)
        self.assertEqual(result["wallet"]["expectedCashPoisha"], 82_500)

        event_id = uuid.UUID(event["eventId"])
        with self.assertRaises(DBAPIError):
            with self.session.begin_nested():
                self.session.execute(
                    text("UPDATE cash_events SET reason = 'rewritten' WHERE id = :id"),
                    {"id": event_id},
                )

    def test_idempotency_replays_the_original_cash_event(self):
        key = uuid.uuid4().hex
        payload = {"kind": "CASH_IN", "amountPoisha": 12_300}
        _, first = self._observe(amount=12_300, key=key)

        with self.assertRaises(idem.ReplayResult) as replay:
            idem.peek(self.session, self.user_id, key, idem.hash_request(payload))
        self.assertEqual(replay.exception.body, first)

        with self.assertRaises(DomainError) as conflict:
            idem.peek(
                self.session,
                self.user_id,
                key,
                idem.hash_request({"kind": "CASH_IN", "amountPoisha": 99}),
            )
        self.assertEqual(conflict.exception.code, "IDEMPOTENCY_KEY_REUSED")

    def test_wallet_ownership_isolation_and_disconnected_fail_closed(self):
        self._observe(amount=45_000)
        owner = smart_wallet.get(self.session, self.user_id)
        other = smart_wallet.get(self.session, self.other_user_id)
        self.assertEqual(owner["expectedCashPoisha"], 45_000)
        self.assertEqual(other["expectedCashPoisha"], 0)
        self.assertEqual(other["activity"], [])

        smart_wallet.set_connection(
            self.session, user_id=self.other_user_id, connected=False
        )
        with self.assertRaises(DomainError) as caught:
            self._observe(user_id=self.other_user_id, amount=100)
        self.assertEqual(caught.exception.code, "SMART_WALLET_DISCONNECTED")

    def test_cash_out_cannot_make_expected_cash_negative(self):
        with self.assertRaises(DomainError) as caught:
            self._observe(kind="CASH_OUT", amount=1)
        self.assertEqual(caught.exception.code, "CASH_INVENTORY_INSUFFICIENT")


class SmartWalletConcurrencyTests(unittest.TestCase):
    def test_concurrent_observations_serialize_into_one_projection(self):
        setup = SessionLocal()
        user_id = uuid.uuid4()
        suffix = str(uuid.uuid4().int)[-8:]
        ledger_before = setup.execute(
            text("SELECT COALESCE(SUM(amount_poisha), 0) FROM journal_entries")
        ).scalar_one()
        setup.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash, is_system) "
                "VALUES (:id, :phone, 'Concurrency Fixture', 'x', TRUE)"
            ),
            {"id": user_id, "phone": "015" + suffix},
        )
        setup.execute(
            text(
                "INSERT INTO smart_wallets (id, user_id, connection_status) "
                "VALUES (:id, :id, 'CONNECTED')"
            ),
            {"id": user_id},
        )
        setup.commit()
        setup.close()

        barrier = threading.Barrier(2)
        errors = []

        def write(amount: int):
            session = SessionLocal()
            try:
                payload = {"kind": "CASH_IN", "amountPoisha": amount}
                barrier.wait(timeout=5)
                smart_wallet.record_observation(
                    session,
                    user_id=user_id,
                    kind="CASH_IN",
                    amount_poisha=amount,
                    reason=None,
                    idempotency_key=uuid.uuid4().hex,
                    request_hash=idem.hash_request(payload),
                )
                session.commit()
            except Exception as exc:  # captured for the parent test thread
                session.rollback()
                errors.append(exc)
            finally:
                session.close()

        first = threading.Thread(target=write, args=(10_000,))
        second = threading.Thread(target=write, args=(20_000,))
        first.start()
        second.start()
        first.join(timeout=10)
        second.join(timeout=10)

        verify = SessionLocal()
        try:
            wallet = smart_wallet.get(verify, user_id)
            sequences = [event["sequenceNumber"] for event in wallet["activity"]]
            ledger_after = verify.execute(
                text("SELECT COALESCE(SUM(amount_poisha), 0) FROM journal_entries")
            ).scalar_one()
            self.assertEqual(errors, [])
            self.assertEqual(wallet["expectedCashPoisha"], 30_000)
            self.assertEqual(sorted(sequences), [1, 2])
            self.assertEqual(wallet["inventoryDifferencePoisha"], 0)
            self.assertEqual(ledger_after, ledger_before)
        finally:
            verify.close()


if __name__ == "__main__":
    unittest.main()
