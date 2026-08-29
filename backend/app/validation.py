"""Canonical validation for values shared across API request models."""

import re

BD_PHONE = re.compile(r"^01[3-9]\d{8}$")


def normalize_bangladesh_phone(value: str) -> str:
    value = value.strip().replace(" ", "").replace("-", "")
    if value.startswith("+880"):
        value = "0" + value[4:]
    if not BD_PHONE.fullmatch(value):
        raise ValueError("Enter a Bangladeshi mobile number, like 01712345678.")
    return value


def validate_pin(value: str | None) -> str | None:
    if value is not None and (len(value) != 5 or not value.isdigit()):
        raise ValueError("Your PIN must be 5 digits.")
    return value
