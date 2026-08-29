"""Safe client-address handling at the one trusted reverse-proxy boundary."""

import ipaddress

from fastapi import Request

from .config import settings


def _address(value: str | None):
    if not value or len(value) > 64:
        return None
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def client_address(request: Request) -> str:
    peer = _address(request.client.host if request.client else None)
    trusted = any(
        peer in ipaddress.ip_network(cidr, strict=False)
        for cidr in settings.trusted_proxy_cidr_list
        if peer is not None
    )
    if trusted:
        forwarded = request.headers.get("X-Forwarded-For", "")
        # nginx overwrites this header with the socket peer. Still validate it:
        # forwarded data must never become an arbitrary database/log key.
        if len(forwarded) <= 512:
            candidate = _address(forwarded.split(",", 1)[0])
            if candidate is not None:
                return candidate.compressed
    return peer.compressed if peer is not None else "unknown"
