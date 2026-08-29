import unittest
import uuid

from pydantic import ValidationError
from starlette.requests import Request

from app.errors import DomainError
from app.network import client_address
from app.rate_limits import consume
from app.routers.transfers import TransferBody


def request_from(peer: str, forwarded: str | None = None) -> Request:
    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "client": (peer, 1234),
        }
    )


class ClientAddressTests(unittest.TestCase):
    def test_trusted_proxy_value_must_be_an_ip_address(self):
        request = request_from("172.18.0.4", "not-an-ip")
        self.assertEqual(client_address(request), "172.18.0.4")

    def test_untrusted_peer_cannot_supply_forwarded_address(self):
        request = request_from("8.8.8.8", "1.2.3.4")
        self.assertEqual(client_address(request), "8.8.8.8")

    def test_trusted_peer_can_supply_valid_forwarded_address(self):
        request = request_from("172.18.0.4", "203.0.113.20")
        self.assertEqual(client_address(request), "203.0.113.20")


class StrictTransferValidationTests(unittest.TestCase):
    def test_mixed_shorthand_and_group_payload_is_rejected(self):
        with self.assertRaises(ValidationError):
            TransferBody(
                recipientPhone="01712345678",
                amountPoisha=100,
                recipients=[{"phone": "01812345678", "amountPoisha": 100}],
            )

    def test_invalid_phone_and_pin_are_rejected(self):
        for payload in (
            {"recipientPhone": "123", "amountPoisha": 100},
            {"recipientPhone": "01712345678", "amountPoisha": 100, "pin": "12x45"},
        ):
            with self.assertRaises(ValidationError):
                TransferBody(**payload)


class CrossReplicaRateLimitTests(unittest.TestCase):
    def test_counter_rejects_request_above_limit_with_retry_after(self):
        subject = "test-" + uuid.uuid4().hex
        for _ in range(2):
            consume("test_scope", subject, 2)

        with self.assertRaises(DomainError) as caught:
            consume("test_scope", subject, 2)

        self.assertEqual(caught.exception.code, "RATE_LIMITED")
        self.assertIn("Retry-After", caught.exception.headers)
        self.assertGreaterEqual(int(caught.exception.headers["Retry-After"]), 1)


if __name__ == "__main__":
    unittest.main()
