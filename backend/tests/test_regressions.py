import uuid
import unittest

from pydantic import ValidationError
from sqlalchemy import event, text

from app import policy
from app.config import settings
from app.db import SessionLocal, engine
from app.deps import CurrentUser
from app.errors import DomainError
from app.routers.transfers import TransferBody, list_transfers
from app.services.transfer import Recipient, issue_registration_grant, resolve_recipients


class RejectingSession:
    def execute(self, *args, **kwargs):
        raise AssertionError("invalid recipients must be rejected before a database query")


class TransferInputTests(unittest.TestCase):
    def test_group_has_a_bounded_recipient_count(self):
        recipients = [
            {"phone": f"0171234{i:04d}", "amountPoisha": 100}
            for i in range(21)
        ]

        with self.assertRaises(ValidationError):
            TransferBody(recipients=recipients)

    def test_negative_duplicate_cannot_be_netted_into_a_positive_recipient(self):
        recipients = [
            Recipient(phone="01712345678", amount_poisha=200),
            Recipient(phone="01712345678", amount_poisha=-100),
        ]

        with self.assertRaisesRegex(DomainError, "greater than zero"):
            resolve_recipients(RejectingSession(), recipients)

    def test_empty_recipient_list_is_rejected(self):
        with self.assertRaises(ValidationError):
            TransferBody(recipients=[])


class PolicyTests(unittest.TestCase):
    def test_daily_limit_starts_at_midnight_in_dhaka(self):
        sender_user = uuid.uuid4()
        recipient_user = uuid.uuid4()
        sender_account = uuid.uuid4()
        recipient_account = uuid.uuid4()
        transfer_id = uuid.uuid4()
        amount = settings.max_daily_send_poisha

        with SessionLocal() as session:
            session.execute(
                text(
                    "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                    "(:su, :sp, 'Policy Sender', 'x'), (:ru, :rp, 'Policy Recipient', 'x')"
                ),
                {
                    "su": sender_user,
                    "ru": recipient_user,
                    "sp": f"015{str(sender_user.int)[-8:]}",
                    "rp": f"018{str(recipient_user.int)[-8:]}",
                },
            )
            session.execute(
                text(
                    "INSERT INTO accounts (id, user_id, kind) VALUES "
                    "(:sa, :su, 'USER'), (:ra, :ru, 'USER')"
                ),
                {"sa": sender_account, "su": sender_user, "ra": recipient_account, "ru": recipient_user},
            )
            session.execute(
                text(
                    "INSERT INTO transfers "
                    "(id, public_reference, kind, sender_account_id, total_poisha) "
                    "VALUES (:id, :ref, 'P2P', :sender, :amount)"
                ),
                {
                    "id": transfer_id,
                    "ref": "TEST" + uuid.uuid4().hex[:12],
                    "sender": sender_account,
                    "amount": amount,
                },
            )
            session.execute(
                text(
                    "INSERT INTO journal_entries "
                    "(id, transfer_id, account_id, amount_poisha, created_at) VALUES "
                    "(:debit, :tid, :sender, -:amount, "
                    " date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'), "
                    "(:credit, :tid, :recipient, :amount, "
                    " date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka')"
                ),
                {
                    "debit": uuid.uuid4(),
                    "credit": uuid.uuid4(),
                    "tid": transfer_id,
                    "sender": sender_account,
                    "recipient": recipient_account,
                    "amount": amount,
                },
            )

            with self.assertRaises(DomainError) as caught:
                policy.check_daily_total(session, sender_account, 1)
            self.assertEqual(caught.exception.code, "TRANSFER_LIMIT_EXCEEDED")
            session.rollback()


class HistoryQueryTests(unittest.TestCase):
    def test_history_uses_one_database_query(self):
        with SessionLocal() as session:
            user_id = uuid.uuid4()
            account_id = uuid.uuid4()
            phone = "017" + str(user_id.int)[-8:]
            session.execute(
                text(
                    "INSERT INTO users (id, phone, name, pin_hash) "
                    "VALUES (:id, :phone, 'History User', 'x')"
                ),
                {"id": user_id, "phone": phone},
            )
            session.execute(
                text("INSERT INTO accounts (id, user_id, kind) VALUES (:id, :uid, 'USER')"),
                {"id": account_id, "uid": user_id},
            )
            issue_registration_grant(session, user_id, account_id)
            user = CurrentUser(
                user_id=user_id,
                account_id=account_id,
                name="History User",
                phone=phone,
                pin_hash="x",
            )

            statements = []

            def count_query(*args):
                statements.append(args[2])

            event.listen(engine, "before_cursor_execute", count_query)
            try:
                result = list_transfers(user=user, session=session, limit=200, direction=None)
            finally:
                event.remove(engine, "before_cursor_execute", count_query)

            self.assertGreater(len(result["transactions"]), 0)
            self.assertEqual(len(statements), 1, "history must not issue one query per Transfer")
            session.rollback()


if __name__ == "__main__":
    unittest.main()
