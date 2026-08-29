import uuid
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.db import SessionLocal
from app.deps import CurrentUser
from app.services.financial_outlook import build_financial_outlook
from app.services.transfer import issue_registration_grant


DHAKA = ZoneInfo("Asia/Dhaka")


class FinancialOutlookTests(unittest.TestCase):
    def setUp(self):
        self.session = SessionLocal()
        self.user_id = uuid.uuid4()
        self.account_id = uuid.uuid4()
        self.phone = "013" + str(self.user_id.int)[-8:]
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash, created_at) "
                "VALUES (:id, :phone, 'Outlook User', 'x', :created_at)"
            ),
            {
                "id": self.user_id,
                "phone": self.phone,
                "created_at": datetime(2026, 1, 1, tzinfo=DHAKA),
            },
        )
        self.session.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind, created_at) "
                "VALUES (:id, :user_id, 'USER', :created_at)"
            ),
            {
                "id": self.account_id,
                "user_id": self.user_id,
                "created_at": datetime(2026, 1, 1, tzinfo=DHAKA),
            },
        )
        issue_registration_grant(self.session, self.user_id, self.account_id)
        self.user = CurrentUser(
            user_id=self.user_id,
            account_id=self.account_id,
            name="Outlook User",
            phone=self.phone,
            pin_hash="x",
        )

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def _counterparty(self, name: str) -> tuple[uuid.UUID, uuid.UUID]:
        user_id = uuid.uuid4()
        account_id = uuid.uuid4()
        phone = "014" + str(user_id.int)[-8:]
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) "
                "VALUES (:id, :phone, :name, 'x')"
            ),
            {"id": user_id, "phone": phone, "name": name},
        )
        self.session.execute(
            text("INSERT INTO accounts (id, user_id, kind) VALUES (:id, :uid, 'USER')"),
            {"id": account_id, "uid": user_id},
        )
        return user_id, account_id

    def _movement(
        self,
        sender_account: uuid.UUID,
        recipient_account: uuid.UUID,
        amount: int,
        created_at: datetime,
    ) -> None:
        transfer_id = uuid.uuid4()
        self.session.execute(
            text(
                "INSERT INTO transfers "
                "(id, public_reference, kind, sender_account_id, total_poisha, created_at, completed_at) "
                "VALUES (:id, :reference, 'P2P', :sender, :amount, :created_at, :created_at)"
            ),
            {
                "id": transfer_id,
                "reference": "OUT" + uuid.uuid4().hex[:16],
                "sender": sender_account,
                "amount": amount,
                "created_at": created_at,
            },
        )
        self.session.execute(
            text(
                "INSERT INTO journal_entries (id, transfer_id, account_id, amount_poisha, created_at) "
                "VALUES (:debit, :transfer, :sender, -:amount, :created_at), "
                "(:credit, :transfer, :recipient, :amount, :created_at)"
            ),
            {
                "debit": uuid.uuid4(),
                "credit": uuid.uuid4(),
                "transfer": transfer_id,
                "sender": sender_account,
                "recipient": recipient_account,
                "amount": amount,
                "created_at": created_at,
            },
        )
        self.session.execute(
            text(
                "UPDATE accounts SET balance_poisha = balance_poisha - :amount "
                "WHERE id = :sender"
            ),
            {"amount": amount, "sender": sender_account},
        )
        self.session.execute(
            text(
                "UPDATE accounts SET balance_poisha = balance_poisha + :amount "
                "WHERE id = :recipient"
            ),
            {"amount": amount, "recipient": recipient_account},
        )

    def test_outlook_uses_comparable_periods_and_disclosed_integer_rules(self):
        _, rahim = self._counterparty("Rahim Hasan")
        _, mina = self._counterparty("Mina Akter")

        self._movement(self.account_id, rahim, 100_000, datetime(2026, 5, 5, tzinfo=DHAKA))
        self._movement(self.account_id, rahim, 200_000, datetime(2026, 6, 5, tzinfo=DHAKA))
        self._movement(self.account_id, rahim, 300_000, datetime(2026, 7, 5, tzinfo=DHAKA))
        self._movement(self.account_id, rahim, 500_000, datetime(2026, 8, 5, tzinfo=DHAKA))
        self._movement(self.account_id, mina, 100_000, datetime(2026, 8, 10, tzinfo=DHAKA))
        self._movement(mina, self.account_id, 50_000, datetime(2026, 8, 12, tzinfo=DHAKA))

        result = build_financial_outlook(
            self.session,
            self.user,
            now=datetime(2026, 8, 20, 12, tzinfo=DHAKA),
        )

        self.assertEqual(result["current"]["outgoingPoisha"], 600_000)
        self.assertEqual(result["current"]["incomingPoisha"], 50_000)
        self.assertEqual(result["current"]["netPoisha"], -550_000)
        self.assertEqual(result["current"]["transferCount"], 3)
        self.assertEqual(result["comparison"]["previousOutgoingPoisha"], 300_000)
        self.assertEqual(result["comparison"]["changeBps"], 10_000)
        self.assertEqual(result["comparison"]["band"], "HIGHER")
        self.assertEqual(result["typicalMoneyOut"]["averagePoisha"], 200_000)
        self.assertEqual(result["typicalMoneyOut"]["completeMonthsObserved"], 3)
        self.assertEqual(result["largestRecipient"]["name"], "Rahim Hasan")
        self.assertEqual(result["largestRecipient"]["amountPoisha"], 500_000)
        self.assertEqual(result["largestRecipient"]["shareBps"], 8_333)
        self.assertTrue(result["rules"]["issuanceExcluded"])
        self.assertEqual(len(result["history"]), 6)

    def test_new_account_reports_missing_baselines_instead_of_inventing_health(self):
        self.session.execute(
            text("UPDATE accounts SET created_at = :created_at WHERE id = :id"),
            {
                "created_at": datetime(2026, 8, 10, tzinfo=DHAKA),
                "id": self.account_id,
            },
        )

        result = build_financial_outlook(
            self.session,
            self.user,
            now=datetime(2026, 8, 20, 12, tzinfo=DHAKA),
        )

        self.assertEqual(result["current"]["outgoingPoisha"], 0)
        self.assertIsNone(result["comparison"]["changeBps"])
        self.assertEqual(result["comparison"]["band"], "NO_BASELINE")
        self.assertIsNone(result["typicalMoneyOut"]["averagePoisha"])
        self.assertEqual(result["buffer"]["band"], "NO_BASELINE")
        self.assertIsNone(result["largestRecipient"])


if __name__ == "__main__":
    unittest.main()
