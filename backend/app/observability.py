"""Per-replica request latency, held in this process and nowhere else.

Every other number the operations console shows is read from PostgreSQL, because
a number a process keeps in memory is a number that disagrees between replicas
and vanishes on restart. Latency is the one exception: recording a row per
request would put a write on the hot path purely to measure the hot path.

So this is a bounded ring of the most recent samples for THIS replica, and the
endpoint that serves it says so. A judge reading p95 on the console is reading
one replica's recent traffic, not a system-wide figure, and the card is labelled
with the instance id to make that unmistakable.
"""

import threading
from collections import deque

WINDOW = 500


class LatencyWindow:
    def __init__(self, size: int = WINDOW) -> None:
        self._samples: deque[float] = deque(maxlen=size)
        self._lock = threading.Lock()
        self._observed = 0

    def record(self, latency_ms: float) -> None:
        with self._lock:
            self._samples.append(latency_ms)
            self._observed += 1

    def snapshot(self) -> dict:
        with self._lock:
            samples = sorted(self._samples)
            observed = self._observed

        return {
            "windowSize": self._samples.maxlen,
            "sampleCount": len(samples),
            "observedTotal": observed,
            "p50Ms": _percentile(samples, 50),
            "p95Ms": _percentile(samples, 95),
            "p99Ms": _percentile(samples, 99),
            "maxMs": round(samples[-1], 2) if samples else None,
        }


def _percentile(sorted_samples: list[float], pct: int) -> float | None:
    """Nearest-rank. With a few hundred samples an interpolating definition would
    imply a precision the sample size does not support."""
    if not sorted_samples:
        return None
    rank = max(1, (pct * len(sorted_samples) + 99) // 100)
    return round(sorted_samples[rank - 1], 2)


# Writes are separated from reads deliberately. A console that polls two cheap
# GETs every five seconds would otherwise drag the headline percentile down and
# flatter the transfer engine, which is the thing anyone actually wants measured.
all_requests = LatencyWindow()
write_requests = LatencyWindow()


def record(method: str, latency_ms: float) -> None:
    all_requests.record(latency_ms)
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        write_requests.record(latency_ms)


def snapshot() -> dict:
    return {"all": all_requests.snapshot(), "writes": write_requests.snapshot()}


# The request thread limit, read back from the live limiter at startup.
#
# It cannot be read on demand: anyio's limiter is bound to the event loop, and
# every sync endpoint -- including the one that serves these metrics -- runs in a
# worker thread with no loop of its own. So the value is captured once, on the
# loop, by whoever set it.
_thread_limit: int | None = None


def set_thread_limit(value: int) -> None:
    global _thread_limit
    _thread_limit = value


def thread_limit() -> int | None:
    return _thread_limit
