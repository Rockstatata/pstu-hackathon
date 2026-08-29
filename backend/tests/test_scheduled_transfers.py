import unittest
import uuid
import threading
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app import idempotency as idem
from app.db import SessionLocal
from app.errors import DomainError
from app.security import hash_pin
from app.services import scheduled_transfers, transfer
from app.services.transfer import issue_registration_grant


class ScheduledTransferServiceTests(unittest.TestCase):
    def setUp(self):
        self.session = SessionLocal()
        suffix = str(uuid.uuid4().int)[-8:]
        self.sender_user = uuid.uuid4()
        self.recipient_user = uuid.uuid4()
        self.sender_account = uuid.uuid4()
        self.recipient_account = uuid.uuid4()
        self.sender_phone = "016" + suffix
        self.recipient_phone = "019" + suffix
        self.pin_hash = hash_pin("12345")
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                "(:sender, :sender_phone, 'Scheduler', :pin_hash), "
                "(:recipient, :recipient_phone, 'Recipient', :pin_hash)"
            ),
            {
                "sender": self.sender_user,
                "recipient": self.recipient_user,
                "sender_phone": self.sender_phone,
                "recipient_phone": self.recipient_phone,
                "pin_hash": self.pin_hash,
            },
        )
        self.session.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind) VALUES "
                "(:sender_account, :sender, 'USER'), "
                "(:recipient_account, :recipient, 'USER')"
            ),
            {
                "sender_account": self.sender_account,
                "sender": self.sender_user,
                "recipient_account": self.recipient_account,
                "recipient": self.recipient_user,
            },
        )
        issue_registration_grant(self.session, self.sender_user, self.sender_account)
        issue_registration_grant(self.session, self.recipient_user, self.recipient_account)

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def create_schedule(self, amount: int = 25_000, pin: str | None = "12345"):
        execute_at = datetime.now(timezone.utc) + timedelta(hours=1)
        payload = {
            "recipientPhone": self.recipient_phone,
            "amountPoisha": amount,
            "executeAt": execute_at.isoformat(),
            "note": "Tuition materials",
        }
        return scheduled_transfers.create(
            self.session,
            creator_user_id=self.sender_user,
            sender_account_id=self.sender_account,
            sender_pin_hash=self.pin_hash,
            recipient_phone=self.recipient_phone,
            amount_poisha=amount,
            note="Tuition materials",
            execute_at=execute_at,
            pin=pin,
            idempotency_key="schedule-" + uuid.uuid4().hex,
            request_hash=idem.hash_request(payload),
        )

    def make_due(self, schedule_id: str) -> None:
        self.session.execute(
            text("UPDATE scheduled_transfers SET execute_at = now() - interval '1 second' WHERE id = :id"),
            {"id": uuid.UUID(schedule_id)},
        )

    def test_creation_is_a_pin_authorized_intention_not_a_money_movement(self):
        transfers_before = self.session.execute(text("SELECT COUNT(*) FROM transfers")).scalar_one()
        journal_before = self.session.execute(text("SELECT COUNT(*) FROM journal_entries")).scalar_one()

        with self.assertRaises(DomainError) as caught:
            self.create_schedule(pin=None)
        self.assertEqual(caught.exception.code, "STEP_UP_REQUIRED")

        _, created = self.create_schedule()
        self.assertEqual(created["status"], "SCHEDULED")
        self.assertIsNone(created["transferReference"])
        self.assertEqual(
            self.session.execute(text("SELECT COUNT(*) FROM transfers")).scalar_one(),
            transfers_before,
        )
        self.assertEqual(
            self.session.execute(text("SELECT COUNT(*) FROM journal_entries")).scalar_one(),
            journal_before,
        )

    def test_due_instruction_executes_once_through_the_transfer_engine(self):
        _, created = self.create_schedule()
        self.make_due(created["scheduledTransferId"])

        result = scheduled_transfers.execute_next_due(self.session)
        self.assertEqual(result["status"], "EXECUTED")
        self.assertIsNone(scheduled_transfers.execute_next_due(self.session))

        resource = scheduled_transfers._resource(
            scheduled_transfers.get(
                self.session,
                schedule_id=uuid.UUID(created["scheduledTransferId"]),
                user_id=self.sender_user,
            )
        )
        self.assertEqual(resource["status"], "EXECUTED")
        self.assertIsNotNone(resource["transferReference"])
        linked = self.session.execute(
            text("SELECT COUNT(*) FROM scheduled_transfers WHERE id = :id AND transfer_id IS NOT NULL"),
            {"id": uuid.UUID(created["scheduledTransferId"])},
        ).scalar_one()
        self.assertEqual(linked, 1)

    def test_business_failure_is_recorded_once_without_a_partial_transfer(self):
        _, created = self.create_schedule(amount=10_000_000)
        transfer.execute(
            self.session,
            sender_user_id=self.sender_user,
            sender_account_id=self.sender_account,
            sender_pin_hash=self.pin_hash,
            recipients=[transfer.Recipient(phone=self.recipient_phone, amount_poisha=1)],
            note="Spend before schedule",
            pin="12345",
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request({"amount": 1}),
        )
        self.make_due(created["scheduledTransferId"])

        result = scheduled_transfers.execute_next_due(self.session)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["code"], "INSUFFICIENT_FUNDS")
        self.assertIsNone(scheduled_transfers.execute_next_due(self.session))

        row = self.session.execute(
            text(
                "SELECT status, transfer_id, failure_code FROM scheduled_transfers WHERE id = :id"
            ),
            {"id": uuid.UUID(created["scheduledTransferId"])},
        ).one()
        self.assertEqual(row.status, "FAILED")
        self.assertIsNone(row.transfer_id)
        self.assertEqual(row.failure_code, "INSUFFICIENT_FUNDS")

    def test_cancel_is_owner_scoped_and_terminal(self):
        _, created = self.create_schedule()
        schedule_id = uuid.UUID(created["scheduledTransferId"])
        with self.assertRaises(DomainError) as caught:
            scheduled_transfers.cancel(
                self.session, schedule_id=schedule_id, user_id=self.recipient_user
            )
        self.assertEqual(caught.exception.code, "SCHEDULED_TRANSFER_NOT_FOUND")

        cancelled = scheduled_transfers.cancel(
            self.session, schedule_id=schedule_id, user_id=self.sender_user
        )
        self.assertEqual(cancelled["status"], "CANCELLED")
        self.assertEqual(
            scheduled_transfers.cancel(
                self.session, schedule_id=schedule_id, user_id=self.sender_user
            )["status"],
            "CANCELLED",
        )


class ScheduledTransferConcurrencyTests(unittest.TestCase):
    def test_two_workers_claim_one_due_instruction_once(self):
        setup = SessionLocal()
        suffix = str(uuid.uuid4().int)[-8:]
        sender_user, recipient_user = uuid.uuid4(), uuid.uuid4()
        sender_account, recipient_account = uuid.uuid4(), uuid.uuid4()
        sender_phone, recipient_phone = "015" + suffix, "018" + suffix
        pin_hash = hash_pin("12345")
        setup.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                "(:su, :sp, 'Race Sender', :ph), (:ru, :rp, 'Race Recipient', :ph)"
            ),
            {"su": sender_user, "sp": sender_phone, "ru": recipient_user, "rp": recipient_phone, "ph": pin_hash},
        )
        setup.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind) VALUES "
                "(:sa, :su, 'USER'), (:ra, :ru, 'USER')"
            ),
            {"sa": sender_account, "su": sender_user, "ra": recipient_account, "ru": recipient_user},
        )
        issue_registration_grant(setup, sender_user, sender_account)
        issue_registration_grant(setup, recipient_user, recipient_account)
        execute_at = datetime.now(timezone.utc) + timedelta(hours=1)
        _, created = scheduled_transfers.create(
            setup,
            creator_user_id=sender_user,
            sender_account_id=sender_account,
            sender_pin_hash=pin_hash,
            recipient_phone=recipient_phone,
            amount_poisha=50_000,
            note="Concurrent claim proof",
            execute_at=execute_at,
            pin="12345",
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request({"executeAt": execute_at.isoformat()}),
        )
        schedule_id = uuid.UUID(created["scheduledTransferId"])
        setup.execute(
            text("UPDATE scheduled_transfers SET execute_at = now() - interval '1 second' WHERE id = :id"),
            {"id": schedule_id},
        )
        setup.commit()
        setup.close()

        barrier = threading.Barrier(2)
        results: list[dict | None] = []
        errors: list[Exception] = []

        def execute() -> None:
            session = SessionLocal()
            try:
                barrier.wait(timeout=5)
                results.append(scheduled_transfers.execute_next_due(session))
                session.commit()
            except Exception as exc:
                session.rollback()
                errors.append(exc)
            finally:
                session.close()

        workers = [threading.Thread(target=execute) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=10)

        verify = SessionLocal()
        try:
            row = verify.execute(
                text("SELECT status, transfer_id FROM scheduled_transfers WHERE id = :id"),
                {"id": schedule_id},
            ).one()
            self.assertEqual(errors, [])
            self.assertEqual(sum(result is not None for result in results), 1)
            self.assertEqual(row.status, "EXECUTED")
            self.assertIsNotNone(row.transfer_id)
            self.assertEqual(
                verify.execute(
                    text("SELECT COUNT(*) FROM journal_entries WHERE transfer_id = :id"),
                    {"id": row.transfer_id},
                ).scalar_one(),
                2,
            )
        finally:
            verify.close()


if __name__ == "__main__":
    unittest.main()
