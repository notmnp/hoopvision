import os
import random
import threading
import time
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from nba_api.stats.library.http import NBAStatsHTTP


NBA_STATS_TIMEOUT_SECONDS = float(os.getenv("NBA_STATS_TIMEOUT_SECONDS", "12"))
NBA_STATS_RETRIES = int(os.getenv("NBA_STATS_RETRIES", "2"))
NBA_STATS_RETRY_BACKOFF_SECONDS = float(
    os.getenv("NBA_STATS_RETRY_BACKOFF_SECONDS", "0.75")
)
NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS = float(
    os.getenv("NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS", "1.0")
)
NBA_STATS_CACHE_TTL_SECONDS = float(os.getenv("NBA_STATS_CACHE_TTL_SECONDS", "86400"))

NBA_STATS_HEADERS = NBAStatsHTTP.headers.copy()

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()
_last_request_at = 0.0


def fetch_stats_data(
    cache_key: str,
    endpoint_factory: Callable[[], Any],
    *,
    ttl_seconds: float = NBA_STATS_CACHE_TTL_SECONDS,
) -> dict[str, Any]:
    cached_data = _get_cached(cache_key, ttl_seconds)
    if cached_data is not None:
        return cached_data

    last_error: Exception | None = None
    for attempt in range(NBA_STATS_RETRIES):
        try:
            _throttle_request()
            endpoint = endpoint_factory()
            data = endpoint.get_normalized_dict()
            _set_cached(cache_key, data)
            return deepcopy(data)
        except Exception as error:
            last_error = error
            if attempt < NBA_STATS_RETRIES - 1:
                time.sleep(_backoff_seconds(attempt))

    raise last_error or RuntimeError("NBA Stats unavailable")


def _get_cached(cache_key: str, ttl_seconds: float) -> dict[str, Any] | None:
    cached = _cache.get(cache_key)
    if not cached:
        return None

    cached_at, data = cached
    if time.monotonic() - cached_at > ttl_seconds:
        _cache.pop(cache_key, None)
        return None

    return deepcopy(data)


def _set_cached(cache_key: str, data: dict[str, Any]) -> None:
    _cache[cache_key] = (time.monotonic(), deepcopy(data))


def _throttle_request() -> None:
    global _last_request_at

    with _lock:
        elapsed = time.monotonic() - _last_request_at
        if elapsed < NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS:
            time.sleep(NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS - elapsed)
        _last_request_at = time.monotonic()


def _backoff_seconds(attempt: int) -> float:
    jitter = random.uniform(0, NBA_STATS_RETRY_BACKOFF_SECONDS)
    return NBA_STATS_RETRY_BACKOFF_SECONDS * (2**attempt) + jitter
