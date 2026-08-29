"""Poisha is the unit. Taka exist only in what a human reads."""

POISHA_PER_TAKA = 100


def taka_to_poisha(taka: str | float | int) -> int:
    """Parse a human-entered taka amount into integer poisha.

    Goes through Decimal, never float, so 0.1 + 0.2 problems cannot reach the Ledger.
    """
    from decimal import Decimal, InvalidOperation

    try:
        value = Decimal(str(taka))
    except InvalidOperation as exc:
        raise ValueError("not a valid amount") from exc
    poisha = value * POISHA_PER_TAKA
    if poisha != poisha.to_integral_value():
        raise ValueError("amount has sub-poisha precision")
    return int(poisha)


def format_taka(poisha: int) -> str:
    sign = "-" if poisha < 0 else ""
    whole, part = divmod(abs(poisha), POISHA_PER_TAKA)
    return f"{sign}{whole:,}.{part:02d}"
