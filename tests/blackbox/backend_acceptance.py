"""Black-box merge gate. Run against the three-replica test gateway."""

import json
import os
import random
import statistics
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.getenv("BASE_URL", "http://gateway/api/v1")


def call(method, path, *, token=None, body=None, key=None, headers=None):
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if key:
        request_headers["Idempotency-Key"] = key
    raw = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE_URL + path, data=raw, headers=request_headers, method=method
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw_response = response.read()
            try:
                payload = json.loads(raw_response or b"{}")
            except json.JSONDecodeError:
                payload = {"raw": raw_response.decode(errors="replace")}
            return response.status, payload, response.headers, time.perf_counter() - started
    except urllib.error.HTTPError as error:
        raw_error = error.read()
        try:
            payload = json.loads(raw_error)
        except json.JSONDecodeError:
            payload = {"raw": raw_error.decode(errors="replace")}
        return error.code, payload, error.headers, time.perf_counter() - started


def phone(operator="7"):
    return f"01{operator}{random.randint(0, 99_999_999):08d}"


def register(name, operator="7", pin="12345"):
    number = phone(operator)
    status, body, _, _ = call(
        "POST", "/auth/register", body={"name": name, "phone": number, "pin": pin}
    )
    assert status == 201, (status, body)
    return {"phone": number, "pin": pin, "token": body["token"]}


def error_code(result):
    return result[1].get("error", {}).get("code")


def main():
    auth_headers = {"X-Forwarded-For": f"198.51.100.{random.randint(1, 254)}"}
    requester = register("Blackbox Requester", "3")
    payer = register("Blackbox Payer", "4", "54321")
    third = register("Blackbox Third", "5")

    # Issuance, login timing parity, and recipient privacy.
    status, account, _, _ = call("GET", "/accounts/me", token=requester["token"])
    assert status == 200 and account["balancePoisha"] == 10_000_000
    known_times, unknown_times = [], []
    for known in (True, False, True, False, True, False):
        number = requester["phone"] if known else phone("9")
        result = call(
            "POST",
            "/auth/login",
            headers=auth_headers,
            body={"phone": number, "pin": "99999"},
        )
        assert result[0] == 401 and error_code(result) == "UNAUTHENTICATED"
        (known_times if known else unknown_times).append(result[3])
    ratio = max(statistics.median(known_times), statistics.median(unknown_times)) / max(
        0.001, min(statistics.median(known_times), statistics.median(unknown_times))
    )
    assert ratio < 4, ratio
    status, lookup, _, _ = call(
        "GET", f"/users/lookup?phone={payer['phone']}", token=requester["token"]
    )
    assert status == 200 and lookup["maskedPhone"] != payer["phone"] and "phone" not in lookup

    # Login lockout remains stricter than the broad IP rate limit.
    locked = register("Blackbox Lockout", "6", "24680")
    for _ in range(5):
        result = call(
            "POST",
            "/auth/login",
            headers=auth_headers,
            body={"phone": locked["phone"], "pin": "00000"},
        )
        assert result[0] == 401
    result = call(
        "POST",
        "/auth/login",
        headers=auth_headers,
        body={"phone": locked["phone"], "pin": "24680"},
    )
    assert result[0] == 429 and error_code(result) == "TOO_MANY_ATTEMPTS"

    # Strict forms, Step-Up, idempotency replay/conflict, Group Transfer, history.
    mixed = call(
        "POST",
        "/transfers",
        token=requester["token"],
        key=uuid.uuid4().hex,
        body={
            "recipientPhone": payer["phone"],
            "amountPoisha": 100,
            "recipients": [{"phone": third["phone"], "amountPoisha": 100}],
        },
    )
    assert mixed[0] == 422
    step_up_key = uuid.uuid4().hex
    intent = {"recipientPhone": payer["phone"], "amountPoisha": 1_000, "note": "blackbox"}
    required = call(
        "POST", "/transfers", token=requester["token"], key=step_up_key, body=intent
    )
    assert required[0] == 403 and error_code(required) == "STEP_UP_REQUIRED"
    committed = call(
        "POST",
        "/transfers",
        token=requester["token"],
        key=step_up_key,
        body={**intent, "pin": requester["pin"]},
    )
    assert committed[0] == 201 and committed[2]["X-Idempotent-Replay"] == "false"
    replay = call(
        "POST",
        "/transfers",
        token=requester["token"],
        key=step_up_key,
        body={**intent, "pin": requester["pin"]},
    )
    assert replay[0] == 201 and replay[2]["X-Idempotent-Replay"] == "true"
    conflict = call(
        "POST",
        "/transfers",
        token=requester["token"],
        key=step_up_key,
        body={"recipientPhone": payer["phone"], "amountPoisha": 2_000},
    )
    assert conflict[0] == 409 and error_code(conflict) == "IDEMPOTENCY_KEY_REUSED"
    group = call(
        "POST",
        "/transfers",
        token=requester["token"],
        key=uuid.uuid4().hex,
        body={
            "recipients": [
                {"phone": payer["phone"], "amountPoisha": 200},
                {"phone": third["phone"], "amountPoisha": 300},
            ],
            "pin": requester["pin"],
        },
    )
    assert group[0] == 201 and group[1]["kind"] == "GROUP"
    detail = call(
        "GET", f"/transfers/{committed[1]['reference']}", token=requester["token"]
    )
    assert detail[0] == 200 and detail[1]["reversible"] is False

    # Complete Money Request lifecycle, authorization privacy, and races.
    create_key = uuid.uuid4().hex
    created = call(
        "POST",
        "/money-requests",
        token=requester["token"],
        key=create_key,
        body={"payerPhone": payer["phone"], "amountPoisha": 1_234, "reason": "Lunch"},
    )
    assert created[0] == 201 and created[1]["status"] == "PENDING"
    request_id = created[1]["requestId"]
    assert call("GET", f"/money-requests/{request_id}", token=third["token"])[0] == 404
    incoming = call(
        "GET", "/money-requests?direction=incoming&status=PENDING&limit=10", token=payer["token"]
    )
    assert incoming[0] == 200 and any(
        item["requestId"] == request_id for item in incoming[1]["moneyRequests"]
    )
    pay_key = uuid.uuid4().hex
    paid = call(
        "POST",
        f"/money-requests/{request_id}/pay",
        token=payer["token"],
        key=pay_key,
        body={"pin": payer["pin"]},
    )
    assert paid[0] == 201 and paid[1]["moneyRequestId"] == request_id
    paid_replay = call(
        "POST",
        f"/money-requests/{request_id}/pay",
        token=payer["token"],
        key=pay_key,
        body={"pin": payer["pin"]},
    )
    assert paid_replay[0] == 201 and paid_replay[2]["X-Idempotent-Replay"] == "true"
    second_pay = call(
        "POST",
        f"/money-requests/{request_id}/pay",
        token=payer["token"],
        key=uuid.uuid4().hex,
        body={"pin": payer["pin"]},
    )
    assert second_pay[0] == 409 and error_code(second_pay) == "MONEY_REQUEST_NOT_PENDING"

    race = call(
        "POST",
        "/money-requests",
        token=requester["token"],
        key=uuid.uuid4().hex,
        body={"payerPhone": payer["phone"], "amountPoisha": 321, "reason": "Race"},
    )[1]
    with ThreadPoolExecutor(max_workers=2) as pool:
        pay_future = pool.submit(
            call,
            "POST",
            f"/money-requests/{race['requestId']}/pay",
            token=payer["token"],
            key=uuid.uuid4().hex,
            body={"pin": payer["pin"]},
        )
        decline_future = pool.submit(
            call,
            "POST",
            f"/money-requests/{race['requestId']}/decline",
            token=payer["token"],
        )
    race_statuses = {pay_future.result()[0], decline_future.result()[0]}
    assert race_statuses in ({201, 409}, {200, 409}), race_statuses

    cancelled = call(
        "POST",
        "/money-requests",
        token=requester["token"],
        key=uuid.uuid4().hex,
        body={"payerPhone": payer["phone"], "amountPoisha": 111, "reason": "Cancel"},
    )[1]
    first_cancel = call(
        "POST", f"/money-requests/{cancelled['requestId']}/cancel", token=requester["token"]
    )
    retry_cancel = call(
        "POST", f"/money-requests/{cancelled['requestId']}/cancel", token=requester["token"]
    )
    assert first_cancel[0] == retry_cancel[0] == 200
    assert first_cancel[1] == retry_cancel[1]

    # CORS, payload boundary, chaos rollback, replica health, and integrity.
    cors = call(
        "OPTIONS",
        "/transfers",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,idempotency-key,content-type",
        },
    )
    assert cors[0] == 200 and "idempotency-key" in cors[2]["access-control-allow-headers"].lower()
    huge = call(
        "POST",
        "/auth/register",
        body={"phone": phone("8"), "pin": "12345", "name": "x" * 33_000},
    )
    assert huge[0] == 413 and error_code(huge) == "PAYLOAD_TOO_LARGE"
    before = call("GET", "/accounts/me", token=third["token"])[1]["balancePoisha"]
    chaos = call(
        "POST",
        "/chaos/transfers/fail-after-journal",
        token=third["token"],
        key=uuid.uuid4().hex,
        body={
            "recipientPhone": payer["phone"],
            "amountPoisha": 555,
            "pin": third["pin"],
        },
    )
    after = call("GET", "/accounts/me", token=third["token"])[1]["balancePoisha"]
    assert chaos[0] == 503 and error_code(chaos) == "CHAOS_INJECTED" and before == after

    # Exercise each configured public rate-limit scope at its exact boundary.
    login_headers = {"X-Forwarded-For": "203.0.113.77"}
    for attempt in range(21):
        limited_login = call(
            "POST",
            "/auth/login",
            headers=login_headers,
            body={"phone": phone("9"), "pin": "00000"},
        )
        if attempt < 20:
            assert limited_login[0] == 401
    assert limited_login[0] == 429 and error_code(limited_login) == "RATE_LIMITED"
    assert int(limited_login[2]["Retry-After"]) >= 1

    lookup_user = register("Lookup Limit", "8")
    for attempt in range(61):
        limited_lookup = call(
            "GET", f"/users/lookup?phone={payer['phone']}", token=lookup_user["token"]
        )
        if attempt < 60:
            assert limited_lookup[0] == 200
    assert limited_lookup[0] == 429 and error_code(limited_lookup) == "RATE_LIMITED"

    request_limit_user = register("Request Limit", "8")
    for attempt in range(21):
        limited_request = call(
            "POST",
            "/money-requests",
            token=request_limit_user["token"],
            key=uuid.uuid4().hex,
            body={
                "payerPhone": payer["phone"],
                "amountPoisha": 1,
                "reason": f"Rate limit {attempt}",
            },
        )
        if attempt < 20:
            assert limited_request[0] == 201
    assert limited_request[0] == 429 and error_code(limited_request) == "RATE_LIMITED"

    system = call("GET", "/system-info")
    assert system[0] == 200 and system[1]["healthyReplicas"] == 3
    integrity = call("GET", "/integrity")
    assert integrity[0] == 200 and integrity[1]["verdict"] == "HEALTHY"
    assert integrity[1]["totals"]["differencePoisha"] == 0

    print(
        json.dumps(
            {
                "status": "PASS",
                "loginTimingMedianRatio": round(ratio, 2),
                "integrity": integrity[1]["verdict"],
                "healthyReplicas": system[1]["healthyReplicas"],
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
