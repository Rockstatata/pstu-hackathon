import unittest
import uuid

from sqlalchemy import text

from app import idempotency as idem
from app.db import SessionLocal
from app.errors import DomainError
from app.security import hash_pin
from app.services import group_settlement
from app.services.transfer import issue_registration_grant


class GroupSettlementServiceTests(unittest.TestCase):
    def setUp(self):
        self.session = SessionLocal()
        suffix = str(uuid.uuid4().int)[-8:]
        self.users = [uuid.uuid4() for _ in range(3)]
        self.accounts = [uuid.uuid4() for _ in range(3)]
        self.phones = ["013" + suffix, "014" + suffix, "015" + suffix]
        self.pin_hashes = [hash_pin("54321") for _ in range(3)]
        self.session.execute(
            text(
                "INSERT INTO users (id, phone, name, pin_hash) VALUES "
                "(:a, :ap, 'Asha', :ah), (:b, :bp, 'Borna', :bh), (:c, :cp, 'Chayan', :ch)"
            ),
            {
                "a": self.users[0], "ap": self.phones[0], "ah": self.pin_hashes[0],
                "b": self.users[1], "bp": self.phones[1], "bh": self.pin_hashes[1],
                "c": self.users[2], "cp": self.phones[2], "ch": self.pin_hashes[2],
            },
        )
        self.session.execute(
            text(
                "INSERT INTO accounts (id, user_id, kind) VALUES "
                "(:aa, :a, 'USER'), (:ba, :b, 'USER'), (:ca, :c, 'USER')"
            ),
            {
                "aa": self.accounts[0], "a": self.users[0],
                "ba": self.accounts[1], "b": self.users[1],
                "ca": self.accounts[2], "c": self.users[2],
            },
        )
        for user_id, account_id in zip(self.users, self.accounts):
            issue_registration_grant(self.session, user_id, account_id)

        payload = {"name": "Campus dinner", "memberPhones": sorted(self.phones[1:])}
        _, group = group_settlement.create_group(
            self.session,
            creator_user_id=self.users[0],
            creator_phone=self.phones[0],
            name="Campus dinner",
            member_phones=self.phones[1:],
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request(payload),
        )
        self.group_id = uuid.UUID(group["groupId"])

    def tearDown(self):
        self.session.rollback()
        self.session.close()

    def add_equal_expense(self, payer_index: int, participants: list[int], total: int, description: str):
        allocations = [(str(self.users[index]), 0) for index in participants]
        return group_settlement.create_expense(
            self.session,
            group_id=self.group_id,
            actor_user_id=self.users[payer_index],
            paid_by_user_id=str(self.users[payer_index]),
            description=description,
            total_poisha=total,
            split_type="EQUAL",
            allocations=allocations,
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request({"description": description, "total": total}),
        )

    def test_chain_obligations_optimize_to_one_consent_preserving_transfer(self):
        # B owes A 100; C owes B 100. Netting makes one C -> A payment.
        self.add_equal_expense(0, [0, 1], 20_000, "A paid for A and B")
        self.add_equal_expense(1, [1, 2], 20_000, "B paid for B and C")

        plan = group_settlement.settlement_plan(
            self.session, self.group_id, self.users[2]
        )
        self.assertEqual(plan["optimizedTransferCount"], 1)
        self.assertEqual(plan["transfers"][0]["from"]["name"], "Chayan")
        self.assertEqual(plan["transfers"][0]["to"]["name"], "Asha")
        self.assertEqual(plan["transfers"][0]["amountPoisha"], 10_000)
        self.assertTrue(plan["canCurrentUserSettle"])

        fingerprint = {
            "groupId": str(self.group_id),
            "planVersion": plan["planVersion"],
        }
        status, receipt = group_settlement.settle_current_user(
            self.session,
            group_id=self.group_id,
            payer_user_id=self.users[2],
            payer_account_id=self.accounts[2],
            payer_pin_hash=self.pin_hashes[2],
            plan_version=plan["planVersion"],
            pin="54321",
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request(fingerprint),
        )
        self.assertEqual(status, 201)
        self.assertEqual(receipt["totalPoisha"], 10_000)
        self.assertEqual(receipt["expenseGroupId"], str(self.group_id))

        settled = group_settlement.settlement_plan(
            self.session, self.group_id, self.users[2]
        )
        self.assertEqual(settled["optimizedTransferCount"], 0)
        self.assertTrue(all(position["netPoisha"] == 0 for position in settled["positions"]))
        ledger_sum = self.session.execute(
            text("SELECT COALESCE(SUM(amount_poisha), 0) FROM journal_entries")
        ).scalar_one()
        self.assertEqual(ledger_sum, 0)

    def test_equal_exact_and_percentage_splits_sum_to_the_expense(self):
        self.add_equal_expense(0, [0, 1, 2], 10_001, "Equal rounding")
        group_settlement.create_expense(
            self.session,
            group_id=self.group_id,
            actor_user_id=self.users[0],
            paid_by_user_id=str(self.users[0]),
            description="Exact split",
            total_poisha=10_000,
            split_type="EXACT",
            allocations=[(str(self.users[0]), 3_000), (str(self.users[1]), 7_000)],
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request({"kind": "exact"}),
        )
        group_settlement.create_expense(
            self.session,
            group_id=self.group_id,
            actor_user_id=self.users[0],
            paid_by_user_id=str(self.users[0]),
            description="Percentage split",
            total_poisha=10_001,
            split_type="PERCENTAGE",
            allocations=[(str(self.users[0]), 3_333), (str(self.users[1]), 6_667)],
            idempotency_key=uuid.uuid4().hex,
            request_hash=idem.hash_request({"kind": "percentage"}),
        )

        totals = self.session.execute(
            text(
                "SELECT ge.description, ge.total_poisha, SUM(ges.amount_poisha) AS shares "
                "FROM group_expenses ge JOIN group_expense_shares ges ON ges.expense_id = ge.id "
                "WHERE ge.group_id = :gid GROUP BY ge.id, ge.description, ge.total_poisha"
            ),
            {"gid": self.group_id},
        ).all()
        self.assertTrue(totals)
        self.assertTrue(all(row.total_poisha == row.shares for row in totals))

    def test_stale_plan_and_non_member_access_fail_closed(self):
        self.add_equal_expense(0, [0, 1], 20_000, "First expense")
        stale = group_settlement.settlement_plan(
            self.session, self.group_id, self.users[1]
        )
        self.add_equal_expense(0, [0, 2], 10_000, "Plan-changing expense")

        with self.assertRaises(DomainError) as changed:
            group_settlement.settle_current_user(
                self.session,
                group_id=self.group_id,
                payer_user_id=self.users[1],
                payer_account_id=self.accounts[1],
                payer_pin_hash=self.pin_hashes[1],
                plan_version=stale["planVersion"],
                pin="54321",
                idempotency_key=uuid.uuid4().hex,
                request_hash=idem.hash_request(
                    {"groupId": str(self.group_id), "planVersion": stale["planVersion"]}
                ),
            )
        self.assertEqual(changed.exception.code, "SETTLEMENT_PLAN_CHANGED")

        with self.assertRaises(DomainError) as hidden:
            group_settlement.get_group(self.session, self.group_id, uuid.uuid4())
        self.assertEqual(hidden.exception.code, "EXPENSE_GROUP_NOT_FOUND")

    def test_invalid_exact_split_is_rejected_before_any_expense_is_written(self):
        with self.assertRaises(DomainError) as caught:
            group_settlement.create_expense(
                self.session,
                group_id=self.group_id,
                actor_user_id=self.users[0],
                paid_by_user_id=str(self.users[0]),
                description="Broken split",
                total_poisha=10_000,
                split_type="EXACT",
                allocations=[(str(self.users[0]), 1_000), (str(self.users[1]), 1_000)],
                idempotency_key=uuid.uuid4().hex,
                request_hash=idem.hash_request({"kind": "broken"}),
            )
        self.assertEqual(caught.exception.code, "INVALID_EXPENSE_SPLIT")
        count = self.session.execute(
            text("SELECT COUNT(*) FROM group_expenses WHERE group_id = :gid"),
            {"gid": self.group_id},
        ).scalar_one()
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
