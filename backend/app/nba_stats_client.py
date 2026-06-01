import json
import os
import random
import threading
import time
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from nba_api.stats.library.http import NBAStatsHTTP

# Imported defensively: the package ships in production (declared in
# pyproject.toml) but may be absent in a bare local checkout. Without it — or
# without KV credentials — the cache simply runs L1-only.
try:
    from upstash_redis import Redis as _UpstashRedis
except ImportError:  # pragma: no cover - exercised only without the dependency
    _UpstashRedis = None


NBA_STATS_TIMEOUT_SECONDS = float(os.getenv("NBA_STATS_TIMEOUT_SECONDS", "12"))
NBA_STATS_RETRIES = int(os.getenv("NBA_STATS_RETRIES", "2"))
NBA_STATS_RETRY_BACKOFF_SECONDS = float(
    os.getenv("NBA_STATS_RETRY_BACKOFF_SECONDS", "0.75")
)
NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS = float(
    os.getenv("NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS", "1.0")
)
NBA_STATS_CACHE_TTL_SECONDS = float(os.getenv("NBA_STATS_CACHE_TTL_SECONDS", "86400"))

# stats.nba.com blackholes requests from cloud/datacenter IPs (e.g. Vercel's AWS
# ranges), so on a deployed host every nba_api call times out. Routing those
# requests through a residential/ISP proxy works around the block. Supply one or
# more proxy URLs (comma-separated) via NBA_STATS_PROXY, e.g.
# "http://user:pass@p.webshare.io:80"; a request picks one at random. Unset =>
# direct connection (correct for local dev, where the residential IP isn't
# blocked). cdn.nba.com calls (headshots, scoreboard) are NOT proxied — they
# already work from cloud hosts.
NBA_STATS_PROXY = os.getenv("NBA_STATS_PROXY", "").strip()
_NBA_STATS_PROXIES = [p.strip() for p in NBA_STATS_PROXY.split(",") if p.strip()]

NBA_STATS_HEADERS = NBAStatsHTTP.headers.copy()


def nba_stats_proxy() -> str | None:
    """Return a proxy URL for an nba_api call, or None for a direct connection.

    Evaluated per request so a comma-separated NBA_STATS_PROXY list rotates
    across calls. Pass the result as the `proxy=` argument to any nba_api
    endpoint that targets stats.nba.com.
    """
    if not _NBA_STATS_PROXIES:
        return None
    return random.choice(_NBA_STATS_PROXIES)

# Two-tier response cache:
#   L1 — the in-process dict below. Fast and free, but only lives as long as a
#        serverless instance stays warm (a cold start wipes it).
#   L2 — Upstash Redis (Vercel KV). Survives cold starts and is shared across
#        instances, so an expensive tracking-era fetch is paid once globally
#        rather than once per cold instance. Best-effort: any KV failure (or
#        absent credentials/library) silently falls back to L1-only.
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()
_last_request_at = 0.0

# Same credentials Vercel injects for the bracket store; a distinct key prefix
# keeps the two namespaces from colliding in the shared Redis instance.
_KV_REST_API_URL = os.getenv("KV_REST_API_URL")
_KV_REST_API_TOKEN = os.getenv("KV_REST_API_TOKEN")
_kv = (
    _UpstashRedis(url=_KV_REST_API_URL, token=_KV_REST_API_TOKEN)
    if _UpstashRedis is not None and _KV_REST_API_URL and _KV_REST_API_TOKEN
    else None
)
_KV_PREFIX = "nbastats:"


def _kv_get(cache_key: str) -> dict[str, Any] | None:
    if _kv is None:
        return None
    try:
        raw = _kv.get(_KV_PREFIX + cache_key)
    except Exception:
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def _kv_set(cache_key: str, data: dict[str, Any], ttl_seconds: float) -> None:
    if _kv is None:
        return
    try:
        _kv.set(_KV_PREFIX + cache_key, json.dumps(data), ex=int(ttl_seconds))
    except Exception:
        # Cache writes are best-effort; a KV outage must never break a fetch.
        pass


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
            _set_cached(cache_key, data, ttl_seconds)
            return deepcopy(data)
        except Exception as error:
            last_error = error
            if attempt < NBA_STATS_RETRIES - 1:
                time.sleep(_backoff_seconds(attempt))

    raise last_error or RuntimeError("NBA Stats unavailable")


def _get_cached(cache_key: str, ttl_seconds: float) -> dict[str, Any] | None:
    cached = _cache.get(cache_key)
    if cached:
        cached_at, data = cached
        if time.monotonic() - cached_at <= ttl_seconds:
            return deepcopy(data)
        _cache.pop(cache_key, None)

    # L1 miss/expired — fall back to the shared KV layer (survives cold starts).
    kv_data = _kv_get(cache_key)
    if kv_data is not None:
        _cache[cache_key] = (time.monotonic(), deepcopy(kv_data))
        return deepcopy(kv_data)

    return None


def _set_cached(
    cache_key: str,
    data: dict[str, Any],
    ttl_seconds: float = NBA_STATS_CACHE_TTL_SECONDS,
) -> None:
    _cache[cache_key] = (time.monotonic(), deepcopy(data))
    _kv_set(cache_key, data, ttl_seconds)


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
