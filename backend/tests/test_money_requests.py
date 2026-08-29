import unittest
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app import idempotency as idem
from app.db import SessionLocal
from app.errors import DomainError
from app.security import hash_pin
from app.services import money_requests, notifications, transfer
from app.services.transfer import issue_registration_grant


class MoneyRequestServiceTests(unittest.TestCase):
    def setUp(self):
        self.session = SessionLocal()
        suffix = str(uuid.uuid4().int)[-8:]
        self.requester_user = uuid.uuid4()
        self.payer_user = uuid.uuid4()
        self.requester_account = uuid.uuid4()
        self.payer_account = uuid.uuid4()
        self.requester_phone = "013" + suffix
        self.payer_phone = "014" + suffix
        self.requester_hash = hash_pin("12345")
        self.payer_hash = hash_pin("54321")
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                "(:requester, :requester_phone, 'Requester', :requester_hash), "
                "(:payer, :payer_phone, 'Payer', :payer_hash)"
            ),
            {
                "requester": self.requester_user,
                "payer": self.payer_user,
                "requester_phone": self.requester_phone,
                "payer_phone": self.payer_phone,
                "requester_hash": self.requester_hash,
                "payer_hash": self.payer_hash,
            },
        )
        self.session.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind) VALUES "
                "(:requester_account, :requester_user, 'USER'), "
                "(:payer_account, :payer_user, 'USER')"
            ),
            {
                "requester_account": self.requester_account,
                "requester_user": self.requester_user,
                "payer_account": self.payer_account,
                "payer_user": self.payer_user,
            },
        )
        issue_registration_grant(self.session, self.requester_user, self.requester_account)
        issue_registration_grant(self.session, self.payer_user, self.payer_account)

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def create_request(self):
        fingerprint = {
            "payerPhone": self.payer_phone,
            "amountPoisha": 1_234,
            "reason": "Shared lunch",
        }
        return money_requests.create(
            self.session,
            requester_user_id=self.requester_user,
            requester_account_id=self.requester_account,
            payer_phone=self.payer_phone,
            amount_poisha=1_234,
            reason="Shared lunch",
            idempotency_key="create-" + uuid.uuid4().hex,
            request_hash=idem.hash_request(fingerprint),
        )

    def test_create_and_pay_use_one_transfer_transaction(self):
        _, created = self.create_request()
        request_id = uuid.UUID(created["requestId"])
        pay_hash = idem.hash_request({"moneyRequestId": str(request_id)})

        status, receipt = money_requests.pay(
            self.session,
            request_id=request_id,
            payer_user_id=self.payer_user,
            payer_account_id=self.payer_account,
            payer_pin_hash=self.payer_hash,
            pin="54321",
            idempotency_key="pay-" + uuid.uuid4().hex,
            request_hash=pay_hash,
        )

        self.assertEqual(status, 201)
        self.assertEqual(receipt["moneyRequestId"], str(request_id))
        self.assertEqual(receipt["totalPoisha"], 1_234)
        resource = money_requests.get(self.session, request_id, self.payer_account)
        self.assertEqual(resource["status"], "PAID")
        self.assertEqual(resource["transferReference"], receipt["reference"])

        linked_transfers = self.session.execute(
            text("SELECT COUNT(*) FROM money_requests WHERE id = :id AND transfer_id IS NOT NULL"),
            {"id": request_id},
        ).scalar_one()
        self.assertEqual(linked_transfers, 1)

    def test_notifications_are_private_and_follow_request_state(self):
        _, created = self.create_request()
        request_id = uuid.UUID(created["requestId"])

        payer_feed = notifications.list_for_user(
            self.session, user_id=self.payer_user, limit=50, unread_only=True
        )
        request_notice = next(
            item
            for item in payer_feed["notifications"]
            if item["resourceId"] == str(request_id)
        )
        self.assertEqual(request_notice["kind"], "REQUEST_RECEIVED")

        with self.assertRaises(DomainError) as caught:
            notifications.mark_read(
                self.session,
                user_id=self.requester_user,
                notification_id=uuid.UUID(request_notice["notificationId"]),
            )
        self.assertEqual(caught.exception.code, "NOTIFICATION_NOT_FOUND")

        notifications.mark_read(
            self.session,
            user_id=self.payer_user,
            notification_id=uuid.UUID(request_notice["notificationId"]),
        )
        unread = notifications.list_for_user(
            self.session, user_id=self.payer_user, limit=50, unread_only=True
        )
        self.assertNotIn(
            request_notice["notificationId"],
            {item["notificationId"] for item in unread["notifications"]},
        )

        money_requests.pay(
            self.session,
            request_id=request_id,
            payer_user_id=self.payer_user,
            payer_account_id=self.payer_account,
            payer_pin_hash=self.payer_hash,
            pin="54321",
            idempotency_key="pay-" + uuid.uuid4().hex,
            request_hash=idem.hash_request({"moneyRequestId": str(request_id)}),
        )
        requester_feed = notifications.list_for_user(
            self.session, user_id=self.requester_user, limit=50, unread_only=True
        )
        related_kinds = {
            item["kind"]
            for item in requester_feed["notifications"]
            if item["resourceId"] == str(request_id)
        }
        self.assertEqual(related_kinds, {"REQUEST_RESOLVED"})

    def test_expiry_is_derived_and_blocks_state_changes(self):
        _, created = self.create_request()
        request_id = uuid.UUID(created["requestId"])
        self.session.execute(
            text("UPDATE money_requests SET expires_at = :past WHERE id = :id"),
            {"id": request_id, "past": datetime.now(timezone.utc) - timedelta(seconds=1)},
        )

        resource = money_requests.get(self.session, request_id, self.payer_account)
        self.assertEqual(resource["status"], "EXPIRED")
        with self.assertRaises(DomainError) as caught:
            money_requests.transition(
                self.session,
                request_id=request_id,
                actor_user_id=self.payer_user,
                actor_account_id=self.payer_account,
                action="DECLINED",
            )
        self.assertEqual(caught.exception.code, "MONEY_REQUEST_EXPIRED")

    def test_unknown_and_unauthorized_are_both_not_found(self):
        _, created = self.create_request()
        for request_id, viewer in (
            (uuid.uuid4(), self.payer_account),
            (uuid.UUID(created["requestId"]), uuid.uuid4()),
        ):
            with self.assertRaises(DomainError) as caught:
                money_requests.get(self.session, request_id, viewer)
            self.assertEqual(caught.exception.code, "MONEY_REQUEST_NOT_FOUND")

    def test_decline_and_cancel_same_action_retries_are_idempotent(self):
        _, first = self.create_request()
        first_id = uuid.UUID(first["requestId"])
        declined = money_requests.transition(
            self.session,
            request_id=first_id,
            actor_user_id=self.payer_user,
            actor_account_id=self.payer_account,
            action="DECLINED",
        )
        retried = money_requests.transition(
            self.session,
            request_id=first_id,
            actor_user_id=self.payer_user,
            actor_account_id=self.payer_account,
            action="DECLINED",
        )
        self.assertEqual(declined, retried)

        _, second = self.create_request()
        second_id = uuid.UUID(second["requestId"])
        cancelled = money_requests.transition(
            self.session,
            request_id=second_id,
            actor_user_id=self.requester_user,
            actor_account_id=self.requester_account,
            action="CANCELLED",
        )
        retried = money_requests.transition(
            self.session,
            request_id=second_id,
            actor_user_id=self.requester_user,
            actor_account_id=self.requester_account,
            action="CANCELLED",
        )
        self.assertEqual(cancelled, retried)

    def test_reversal_request_requires_consent_and_compensates_with_a_new_transfer(self):
        send_payload = {
            "recipients": [{"phone": self.payer_phone, "amount": 25_000}],
            "note": "Original payment",
        }
        _, original = transfer.execute(
            self.session,
            sender_user_id=self.requester_user,
            sender_account_id=self.requester_account,
            sender_pin_hash=self.requester_hash,
            recipients=[transfer.Recipient(phone=self.payer_phone, amount_poisha=25_000)],
            note="Original payment",
            pin="12345",
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request(send_payload),
        )
        balances_after_send = self.session.execute(
            text("SELECT id, balance_poisha FROM accounts WHERE id = ANY(:ids)"),
            {"ids": [self.requester_account, self.payer_account]},
        ).all()

        reversal_hash = idem.hash_request({"transferReference": original["reference"]})
        _, reversal_request = money_requests.create_reversal_request(
            self.session,
            requester_user_id=self.requester_user,
            requester_account_id=self.requester_account,
            transfer_reference=original["reference"],
            idempotency_key=uuid.uuid4().hex,
            request_hash=reversal_hash,
        )
        self.assertEqual(reversal_request["requestKind"], "REVERSAL")
        self.assertEqual(
            reversal_request["originalTransferReference"], original["reference"]
        )

        pay_hash = idem.hash_request(
            {"moneyRequestId": reversal_request["requestId"]}
        )
        _, compensation = money_requests.pay(
            self.session,
            request_id=uuid.UUID(reversal_request["requestId"]),
            payer_user_id=self.payer_user,
            payer_account_id=self.payer_account,
            payer_pin_hash=self.payer_hash,
            pin="54321",
            idempotency_key=uuid.uuid4().hex,
            request_hash=pay_hash,
        )
        self.assertEqual(compensation["kind"], "REVERSAL")
        self.assertEqual(compensation["totalPoisha"], 25_000)

        original_status = self.session.execute(
            text("SELECT status FROM transfers WHERE public_reference = :reference"),
            {"reference": original["reference"]},
        ).scalar_one()
        self.assertEqual(original_status, "REVERSED")
        balances_after_reversal = self.session.execute(
            text("SELECT id, balance_poisha FROM accounts WHERE id = ANY(:ids)"),
            {"ids": [self.requester_account, self.payer_account]},
        ).all()
        before = {row.id: row.balance_poisha for row in balances_after_send}
        after = {row.id: row.balance_poisha for row in balances_after_reversal}
        self.assertEqual(after[self.requester_account], before[self.requester_account] + 25_000)
        self.assertEqual(after[self.payer_account], before[self.payer_account] - 25_000)

        with self.assertRaises(DomainError) as caught:
            money_requests.create_reversal_request(
                self.session,
                requester_user_id=self.payer_user,
                requester_account_id=self.payer_account,
                transfer_reference=compensation["reference"],
                idempotency_key=uuid.uuid4().hex,
                request_hash=idem.hash_request(
                    {"transferReference": compensation["reference"]}
                ),
            )
        self.assertEqual(caught.exception.code, "TRANSFER_NOT_REVERSIBLE")


if __name__ == "__main__":
    unittest.main()
