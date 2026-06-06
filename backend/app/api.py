import csv
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote

import requests
from fastapi import APIRouter, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from nba_api.stats.static import players
from nba_api.stats.endpoints import commonplayerinfo, draftcombinestats
from nba_api.live.nba.endpoints import scoreboard

from .nba_stats_client import (
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
    nba_stats_proxy,
)
from .player_data import get_player_season_stats, list_player_seasons
from .draft import PlayerPoolResolver
from .draft_eras import get_era, list_eras, list_franchises_for_era
from .draft_scoring import DraftLineup, DraftLineupError, DraftScore, DraftScoringEngine
from .simulation import SimulationEngine
from .bracket import (
    BracketConfig,
    BracketOrchestrator,
    BracketState,
    BracketValidationError,
    _BracketSession,
    default_bracket_config,
)
from .shotchart import shot_chart_service

# Imported defensively: the package ships in production (declared in
# pyproject.toml) but may be absent in a bare local checkout. A missing module
# must NOT prevent the server from starting — bracket endpoints simply surface a
# clear 500 instead (DEPLOY-009). Non-bracket routes are unaffected either way.
try:
    from upstash_redis.asyncio import Redis as _UpstashRedis
except ImportError:  # pragma: no cover - exercised only without the dependency
    _UpstashRedis = None

app = FastAPI()

WINGSPAN_CSV_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "nba_wingspan_performance_2025.csv"
)

CURATED_WINGSPAN_INCHES = {
    "allen iverson": 75.25,
    "bill russell": 88.0,
    "charles barkley": 82.0,
    "dennis rodman": 84.0,
    "hakeem olajuwon": 86.0,
    "jerry west": 81.0,
    "kareem abdul-jabbar": 89.0,
    "karl malone": 84.0,
    "kyrie irving": 76.0,
    "larry bird": 84.0,
    "magic johnson": 84.0,
    "michael jordan": 83.0,
    "oscar robertson": 80.0,
    "scottie pippen": 87.0,
    "shaquille o'neal": 91.0,
    "tim duncan": 89.0,
    "wilt chamberlain": 92.0,
}

POSITION_AVERAGE_WINGSPAN_INCHES = {
    "G": 78.0,
    "F": 83.0,
    "C": 88.0,
}

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All routes are mounted under /api so the single-project Vercel deployment can
# route /api/* to this function while every other path falls back to the SPA.
# CORS and the app instance stay on `app`; only the routes move to the router.
router = APIRouter(prefix="/api")


PossessionMode = Literal["make_it_take_it", "alternating"]


class SimulationRequest(BaseModel):
    player_a_id: int = Field(gt=0)
    player_b_id: int = Field(gt=0)
    season_a_id: str = Field(min_length=1)
    season_b_id: str = Field(min_length=1)
    possession_mode: PossessionMode = "make_it_take_it"
    seed: int | None = None


# Upper bound on bulk simulation count, configurable so deployments can tune
# the per-request work ceiling without code changes.
BULK_SIM_MAX_N = int(os.getenv("BULK_SIM_MAX_N", "1000"))


class BulkSimulationRequest(BaseModel):
    player_a_id: int = Field(gt=0)
    player_b_id: int = Field(gt=0)
    season_a_id: str = Field(min_length=1)
    season_b_id: str = Field(min_length=1)
    possession_mode: PossessionMode = "make_it_take_it"
    n: int = Field(default=1000, gt=0)


class BulkSimulationResult(BaseModel):
    player_a_wins: int
    player_b_wins: int
    ties: int
    total_simulations: int
    player_a_win_pct: float
    player_b_win_pct: float


class ShotZoneResponse(BaseModel):
    zone_label: str
    zone_area: str
    attempts: int
    made: int
    fg_pct: float


class ShotChartResponse(BaseModel):
    available: bool
    zones: list[ShotZoneResponse]
    data_warnings: list[str]


class PlayerSearchSuggestion(BaseModel):
    id: int
    full_name: str


class PlayerSeasonOption(BaseModel):
    season_id: str
    season_label: str


class PlayerSeasonStats(BaseModel):
    season_id: str
    season_label: str
    season_year: int
    team_id: int
    team_abbreviation: str
    points_per_game: float
    fga_per_game: float
    three_point_attempt_rate: float
    free_throw_attempt_rate: float
    assist_per_game: float
    turnover_per_game: float
    rebound_per_game: float
    block_per_game: float
    steal_per_game: float
    personal_foul_per_game: float
    true_shooting_pct: float
    free_throw_pct: float


def _normalize_name(name: str) -> str:
    # Fold accents to ASCII first (Jokić -> Jokic, Dončić -> Doncic) so a query
    # typed without diacritics still matches the static index's accented names.
    # Without this the regex below strips the accented letter to a space and the
    # names never line up (e.g. "nikola joki" vs "nikola jokic").
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", ascii_name.lower()).strip()


def _normalize_player_search_name(name: str) -> str:
    decoded_name = unquote(name).replace("+", " ")
    return re.sub(r"\s+", " ", decoded_name).strip()


def _find_player_matches(name: str) -> list[dict[str, Any]]:
    normalized_query = _normalize_name(_normalize_player_search_name(name))
    if not normalized_query:
        return []

    all_players = players.get_players()
    exact_matches = [
        player
        for player in all_players
        if _normalize_name(player.get("full_name", "")) == normalized_query
    ]
    if exact_matches:
        return exact_matches

    return [
        player
        for player in all_players
        if normalized_query in _normalize_name(player.get("full_name", ""))
    ]


def _first_record(data: dict[str, Any], key: str) -> dict[str, Any]:
    records = data.get(key, [])
    return records[0] if records else {}


def _parse_draft_year(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_wingspan_inches(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A", "-"):
        return None

    if isinstance(value, (int, float)):
        return float(value)

    raw_value = str(value).strip()
    if not raw_value:
        return None

    try:
        return float(raw_value)
    except ValueError:
        pass

    match = re.search(
        r"(\d+)\s*(?:'|ft| feet|-)\s*(\d+(?:\.\d+)?)?", raw_value, re.IGNORECASE
    )
    if match:
        feet = int(match.group(1))
        inches = float(match.group(2) or 0)
        return feet * 12 + inches

    match = re.search(r"(\d+)\s*-\s*(\d+(?:\.\d+)?)", raw_value)
    if match:
        return int(match.group(1)) * 12 + float(match.group(2))

    return None


def _resolve_combine_wingspan(
    player_id: int, player_name: str, draft_year: int | None
) -> float | None:
    if draft_year is None or draft_year < 2000:
        return None

    data = fetch_stats_data(
        "draftcombinestats:all_time",
        lambda: draftcombinestats.DraftCombineStats(
            season_all_time="All Time",
            headers=NBA_STATS_HEADERS.copy(),
            timeout=NBA_STATS_TIMEOUT_SECONDS,
            proxy=nba_stats_proxy(),
        ),
    )
    target_name = _normalize_name(player_name)

    for row in data.get("DraftCombineStats", []):
        row_player_id = row.get("PLAYER_ID")
        if (
            str(row_player_id) == str(player_id)
            or _normalize_name(row.get("PLAYER_NAME", "")) == target_name
        ):
            return _parse_wingspan_inches(
                row.get("WINGSPAN") or row.get("WINGSPAN_FT_IN")
            )

    return None


def _resolve_csv_wingspan(player_name: str) -> float | None:
    if not WINGSPAN_CSV_PATH.exists():
        return None

    target_name = _normalize_name(player_name)
    with WINGSPAN_CSV_PATH.open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            row_name = (
                row.get("player")
                or row.get("player_name")
                or row.get("name")
                or row.get("PLAYER_NAME")
            )
            if not row_name or _normalize_name(row_name) != target_name:
                continue

            for column in (
                "wingspan",
                "wingspan_inches",
                "WINGSPAN",
                "WINGSPAN_INCHES",
                "WINGSPAN_FT_IN",
            ):
                wingspan = _parse_wingspan_inches(row.get(column))
                if wingspan is not None:
                    return wingspan

    return None


def _position_average_wingspan(position: str) -> float:
    normalized_position = position.upper()
    if "C" in normalized_position:
        return POSITION_AVERAGE_WINGSPAN_INCHES["C"]
    if "F" in normalized_position:
        return POSITION_AVERAGE_WINGSPAN_INCHES["F"]
    return POSITION_AVERAGE_WINGSPAN_INCHES["G"]


def _resolve_wingspan(
    player_id: int,
    player_name: str,
    position: str,
    draft_year: int | None,
) -> tuple[float, list[str]]:
    data_warnings: list[str] = []

    for resolver in (
        lambda: _resolve_combine_wingspan(player_id, player_name, draft_year),
        lambda: _resolve_csv_wingspan(player_name),
        lambda: CURATED_WINGSPAN_INCHES.get(_normalize_name(player_name)),
    ):
        try:
            wingspan = resolver()
        except Exception:
            wingspan = None

        if wingspan is not None:
            return wingspan, data_warnings

    data_warnings.append(
        f"Position-average wingspan substituted because no measured wingspan was found for {player_name}."
    )
    return _position_average_wingspan(position), data_warnings


def _build_player_profile(
    player_id: int,
    player_name: str,
    data: dict[str, Any],
    extra_data_warnings: list[str] | None = None,
) -> dict[str, Any]:
    info = _first_record(data, "CommonPlayerInfo")
    headline = _first_record(data, "PlayerHeadlineStats")
    position = info.get("POSITION") or ""
    draft_year = _parse_draft_year(info.get("DRAFT_YEAR"))
    wingspan, data_warnings = _resolve_wingspan(
        player_id, player_name, position, draft_year
    )
    data_warnings.extend(extra_data_warnings or [])

    return {
        "player_id": player_id,
        "name": info.get("DISPLAY_FIRST_LAST") or player_name,
        "height": info.get("HEIGHT"),
        "weight": info.get("WEIGHT"),
        "position": position,
        "team": info.get("TEAM_NAME"),
        "from_year": info.get("FROM_YEAR"),
        "to_year": info.get("TO_YEAR"),
        "draft_year": info.get("DRAFT_YEAR"),
        "wingspan": wingspan,
        "data_warnings": data_warnings,
        "headline_stats": {
            "points": headline.get("PTS"),
            "assists": headline.get("AST"),
            "rebounds": headline.get("REB"),
            "pie": headline.get("PIE"),
        },
    }


def _fetch_common_player_info(player_id: int) -> dict[str, Any]:
    return fetch_stats_data(
        f"commonplayerinfo:{player_id}",
        lambda: commonplayerinfo.CommonPlayerInfo(
            player_id=player_id,
            headers=NBA_STATS_HEADERS.copy(),
            timeout=NBA_STATS_TIMEOUT_SECONDS,
            proxy=nba_stats_proxy(),
        ),
    )


def _fallback_player_profile(
    player_id: int,
    player_name: str,
    detail: str,
) -> dict[str, Any]:
    wingspan, data_warnings = _resolve_wingspan(
        player_id=player_id,
        player_name=player_name,
        position="",
        draft_year=None,
    )
    data_warnings.append(
        f"NBA Stats profile lookup failed, so limited fallback data is shown: {detail}"
    )

    return {
        "player_id": player_id,
        "name": player_name,
        "height": None,
        "weight": None,
        "position": None,
        "team": None,
        "from_year": None,
        "to_year": None,
        "draft_year": None,
        "wingspan": wingspan,
        "data_warnings": data_warnings,
        "headline_stats": {
            "points": None,
            "assists": None,
            "rebounds": None,
            "pie": None,
        },
    }


def _player_name_from_id(player_id: int) -> str:
    for player in players.get_players():
        if player.get("id") == player_id:
            return player["full_name"]
    return str(player_id)


def _get_player_profile_by_id(player_id: int) -> dict[str, Any]:
    try:
        data = _fetch_common_player_info(player_id)
    except Exception as error:
        return _fallback_player_profile(
            player_id,
            _player_name_from_id(player_id),
            str(error),
        )

    common_info = _first_record(data, "CommonPlayerInfo")
    player_name = common_info.get("DISPLAY_FIRST_LAST") or str(player_id)
    return _build_player_profile(player_id, player_name, data)


@router.get("/", tags=["root"])
async def read_root() -> dict:
    return {"message": "Welcome to your NBA API backend."}


@router.get(
    "/players/search",
    tags=["nba"],
    response_model=list[PlayerSearchSuggestion],
)
async def search_players(q: str = ""):
    # Backs the type-ahead dropdown. Queries the in-process static player index
    # (no NBA Stats call), so no caching is required. Exact name matches rank
    # ahead of partial matches via _find_player_matches; an empty query or no
    # match yields an empty list rather than a 404.
    matches = _find_player_matches(q)
    return [
        {"id": player["id"], "full_name": player["full_name"]}
        for player in matches[:10]
    ]


@router.get("/player/{name}", tags=["nba"])
async def get_player_info(name: str):
    matched_players = _find_player_matches(name)
    if not matched_players:
        raise HTTPException(status_code=404, detail="Player not found")

    player = matched_players[0]  # Get first match
    player_id = player["id"]

    try:
        data = _fetch_common_player_info(player_id)
        return {
            "player": player["full_name"],
            "data": _build_player_profile(player_id, player["full_name"], data),
        }
    except Exception as e:
        return {
            "player": player["full_name"],
            "data": _fallback_player_profile(player_id, player["full_name"], str(e)),
        }


@router.get(
    "/player/{player_id}/seasons",
    tags=["nba"],
    response_model=list[PlayerSeasonOption],
)
async def get_player_seasons(player_id: int):
    try:
        return list_player_seasons(player_id)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to load player seasons: {str(e)}",
        )


@router.get(
    "/player/{player_id}/season/{season_id}",
    tags=["nba"],
    response_model=PlayerSeasonStats,
)
async def get_player_season(player_id: int, season_id: str):
    try:
        stats = get_player_season_stats(player_id, season_id)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to load player season stats: {str(e)}",
        )

    if stats is None:
        raise HTTPException(
            status_code=404,
            detail=f"No regular-season stats found for season {season_id}",
        )
    return stats


@router.get(
    "/shotchart/{player_id}/{season}",
    tags=["nba"],
    response_model=ShotChartResponse,
)
async def get_shot_chart(player_id: int, season: str):
    # Pre-tracking-era seasons resolve to available=false with a warning (a 200
    # response), so only an actual upstream failure is surfaced as an error.
    try:
        return shot_chart_service.get_shot_chart(player_id, season).to_dict()
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to load shot chart: {str(e)}",
        )


# The live CDN (cdn.nba.com) is fronted by Akamai, which now rejects
# nba_api's default headers with a 403. Supplying browser-like headers with
# an nba.com Referer/Origin gets the request through.
NBA_LIVE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Connection": "keep-alive",
}


NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{player_id}.png"


# Defined as a sync `def` (not `async def`) so FastAPI runs the blocking
# requests.get in a worker thread rather than stalling the event loop.
@router.get("/headshot/{player_id}", tags=["nba"])
def get_headshot(player_id: int):
    # Proxy the NBA CDN headshot through our own (CORS-enabled) origin. The CDN
    # sends no Access-Control-Allow-Origin, so a crossOrigin="anonymous" <img>
    # — which the bracket PNG export needs so html2canvas's canvas isn't
    # tainted — can't load it directly. Serving the bytes here means the browser
    # can both display the photo and read its pixels for export.
    try:
        upstream = requests.get(
            NBA_HEADSHOT_URL.format(player_id=player_id),
            headers=NBA_LIVE_HEADERS,
            timeout=10,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch headshot: {e}")
    if upstream.status_code != 200:
        raise HTTPException(status_code=404, detail="Headshot not found")
    return Response(
        content=upstream.content,
        media_type=upstream.headers.get("Content-Type", "image/png"),
        # `Vary: Origin` MUST be set on every response, not just CORS ones.
        # CORSMiddleware only adds it when an `Origin` header is present, so a
        # non-CORS request (a plain `<img>` without crossOrigin, a prefetch, or
        # opening the URL directly) gets a cacheable response with NO `Vary` and
        # NO `Access-Control-Allow-Origin`. The browser then reuses that poisoned
        # cache entry for a later `crossOrigin="anonymous"` <img>, which fails the
        # CORS check and breaks the headshot. Setting it here keeps the CORS and
        # non-CORS variants from ever sharing a cache entry.
        headers={"Cache-Control": "public, max-age=86400", "Vary": "Origin"},
    )


@router.get("/scoreboard", tags=["nba"])
async def get_today_scoreboard():
    try:
        games = scoreboard.ScoreBoard(headers=NBA_LIVE_HEADERS)
        return games.get_dict()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch scoreboard: {str(e)}"
        )


@router.post("/simulate", tags=["iso"])
async def simulate_matchup(request: SimulationRequest):
    if request.player_a_id == request.player_b_id:
        raise HTTPException(status_code=400, detail="Players must be different")

    try:
        engine = SimulationEngine(profile_provider=_get_player_profile_by_id)
        return engine.simulate(
            request.player_a_id,
            request.player_b_id,
            request.season_a_id,
            request.season_b_id,
            possession_mode=request.possession_mode,
            seed=request.seed,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to run simulation: {str(e)}"
        )


@router.post("/simulate/bulk", tags=["iso"], response_model=BulkSimulationResult)
async def simulate_bulk(request: BulkSimulationRequest):
    if request.player_a_id == request.player_b_id:
        raise HTTPException(status_code=400, detail="Players must be different")

    # Runs in-process and sequentially per ADR-002. Profiles are built once and
    # the game loop is replayed across seeds, so the cost scales with N rather
    # than re-fetching player data each run. If per-request computation time
    # grows unacceptable, a task-queue pattern (e.g. Celery + Redis) is the
    # appropriate next step.
    n = min(request.n, BULK_SIM_MAX_N)
    try:
        engine = SimulationEngine(profile_provider=_get_player_profile_by_id)
        return engine.simulate_bulk(
            request.player_a_id,
            request.player_b_id,
            request.season_a_id,
            request.season_b_id,
            n,
            possession_mode=request.possession_mode,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to run bulk simulation: {str(e)}"
        )


# A single orchestrator instance owns the in-process bracket session store
# (ADR-002). It reuses one SimulationEngine since the engine is stateless beyond
# its cached profile builder. On Vercel the in-process store is destroyed on
# every cold start, so bracket sessions are persisted to Vercel KV (Upstash
# Redis) and the orchestrator's `_sessions` dict is used only as a per-request
# working copy that is hydrated from KV on demand.
bracket_orchestrator = BracketOrchestrator(
    engine=SimulationEngine(profile_provider=_get_player_profile_by_id)
)


# Bracket sessions live in Vercel KV with a 24h TTL: an untouched bracket is
# treated as abandoned after one day.
_BRACKET_KV_TTL_SECONDS = 86400

# Initialized once at module level (not per-request). It is None when the KV
# credentials are absent (or the client library is unavailable) so the server
# still starts. KV is an OPTIONAL durability layer over the orchestrator's
# in-process session store: when it's configured, brackets survive serverless
# cold starts and can be shared across instances; when it isn't (e.g. local
# dev), the endpoints fall back to in-memory sessions — brackets are ephemeral /
# session-only by design, so this degrades gracefully exactly like the NBA-stats
# client's optional cache rather than erroring (see DEPLOY-009 history).
_KV_REST_API_URL = os.getenv("KV_REST_API_URL")
_KV_REST_API_TOKEN = os.getenv("KV_REST_API_TOKEN")
_kv_redis = (
    _UpstashRedis(url=_KV_REST_API_URL, token=_KV_REST_API_TOKEN)
    if _UpstashRedis is not None and _KV_REST_API_URL and _KV_REST_API_TOKEN
    else None
)


def _kv_key(bracket_id: str) -> str:
    return f"bracket:{bracket_id}"


async def _kv_save_bracket(
    bracket_id: str, state: BracketState, possession_mode: str
) -> None:
    # No-op when KV is absent: the orchestrator already holds the live session
    # in memory, so skipping the durable write loses nothing on a single
    # instance. A KV outage must never break a simulation.
    if _kv_redis is None:
        return
    payload = json.dumps(
        {"state": state.model_dump(mode="json"), "possession_mode": possession_mode}
    )
    try:
        await _kv_redis.set(_kv_key(bracket_id), payload, ex=_BRACKET_KV_TTL_SECONDS)
    except Exception:
        # Persistence is best-effort; the in-memory session remains the source
        # of truth for the rest of this process's lifetime.
        pass


async def _kv_load_bracket(bracket_id: str) -> tuple[BracketState, str] | None:
    if _kv_redis is None:
        return None
    try:
        raw = await _kv_redis.get(_kv_key(bracket_id))
    except Exception:
        return None
    if raw is None:
        return None
    data = json.loads(raw)
    state = BracketState.model_validate(data["state"])
    return state, data["possession_mode"]


async def _hydrate_session(bracket_id: str) -> str:
    # Prefer the durable KV copy (injecting it into the in-process store so the
    # existing get_state/run_round/run_all paths work even after a cold start).
    # When KV is unavailable, fall back to the session create_bracket/run_round
    # already keep in memory. 404 only when the bracket is in neither place.
    loaded = await _kv_load_bracket(bracket_id)
    if loaded is not None:
        state, possession_mode = loaded
        bracket_orchestrator._sessions[bracket_id] = _BracketSession(
            state=state, possession_mode=possession_mode
        )
        return possession_mode
    session = bracket_orchestrator._sessions.get(bracket_id)
    if session is not None:
        return session.possession_mode
    raise HTTPException(status_code=404, detail="Bracket not found")


class CreateBracketResponse(BaseModel):
    bracket_id: str
    bracket_state: BracketState


@router.post("/bracket", tags=["bracket"], response_model=CreateBracketResponse)
async def create_bracket(config: BracketConfig):
    # Backfill any missing display names from the static player index so the
    # bracket view can label every participant (and advancing winner) by name.
    for participant in config.participants:
        if not participant.name:
            participant.name = _player_name_from_id(participant.player_id)
    try:
        state = bracket_orchestrator.create_bracket(config)
    except BracketValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _kv_save_bracket(state.bracket_id, state, config.possession_mode)
    return {"bracket_id": state.bracket_id, "bracket_state": state}


def _resolve_player_id_by_name(name: str) -> int | None:
    # Exact, case-insensitive match against the in-process static player index
    # (no NBA Stats call) used to back the curated default brackets.
    matches = players.find_players_by_full_name(f"^{re.escape(name)}$")
    return matches[0]["id"] if matches else None


@router.get("/bracket/default/{size}", tags=["bracket"], response_model=BracketConfig)
async def get_default_bracket(size: int):
    try:
        return default_bracket_config(size, _resolve_player_id_by_name)
    except BracketValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/bracket/{bracket_id}", tags=["bracket"], response_model=BracketState)
async def get_bracket(bracket_id: str):
    await _hydrate_session(bracket_id)
    return bracket_orchestrator.get_state(bracket_id)


@router.post(
    "/bracket/{bracket_id}/run-round", tags=["bracket"], response_model=BracketState
)
async def run_bracket_round(bracket_id: str):
    possession_mode = await _hydrate_session(bracket_id)
    try:
        state = await bracket_orchestrator.run_round(bracket_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Bracket not found")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to simulate round: {str(e)}"
        )
    await _kv_save_bracket(bracket_id, state, possession_mode)
    return state


@router.post(
    "/bracket/{bracket_id}/run-all", tags=["bracket"], response_model=BracketState
)
async def run_bracket_all(bracket_id: str):
    possession_mode = await _hydrate_session(bracket_id)
    try:
        state = await bracket_orchestrator.run_all(bracket_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Bracket not found")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to simulate bracket: {str(e)}"
        )
    await _kv_save_bracket(bracket_id, state, possession_mode)
    return state


# --- All-Time Draft Challenge ---------------------------------------------
#
# Stateless pool resolution (ADR-002): the server holds no draft session. The
# resolver lazy-loads the bundled advanced-stats CSV once and layers PPG/APG/RPG
# from PlayerDataService onto each pool entry at request time.
player_pool_resolver = PlayerPoolResolver(
    season_stats_provider=get_player_season_stats
)


@router.get("/draft/eras", tags=["draft"])
async def get_draft_eras() -> dict:
    # Static era list (ADR-003) the client renders the era spinner from.
    return {"eras": list_eras()}


@router.get("/draft/franchises", tags=["draft"])
async def get_draft_franchises(era: str) -> dict:
    # Only franchises that fielded a team during the era, named for that era
    # (e.g. "Seattle SuperSonics" in the 1990s, "Oklahoma City Thunder" later).
    if get_era(era) is None:
        raise HTTPException(status_code=400, detail=f"Unknown era: {era}")
    return {"franchises": list_franchises_for_era(era)}


@router.get("/draft/pool", tags=["draft"])
async def get_draft_pool(era: str, franchise_id: str, exclude: str = ""):
    # `exclude` is the client's cumulative seen-player list (cross-spin
    # deduplication, AC-ATD-008.2); silently ignore any non-integer tokens.
    exclude_ids = {
        int(token)
        for token in exclude.split(",")
        if token.strip().lstrip("-").isdigit()
    }
    result = player_pool_resolver.resolve_pool(era, franchise_id, exclude_ids)
    if result is None:
        raise HTTPException(
            status_code=404, detail="Unknown era or franchise for the draft pool"
        )
    return result


# TS% comes from PlayerDataService basic stats when reachable, falling back to
# the bundled CSV's TS% so scoring stays deterministic and offline-capable.
draft_scoring_engine = DraftScoringEngine(
    season_stats_provider=get_player_season_stats
)


@router.post("/draft/score", tags=["draft"], response_model=DraftScore)
async def score_draft_lineup(lineup: DraftLineup):
    try:
        return draft_scoring_engine.score(lineup)
    except DraftLineupError as error:
        raise HTTPException(status_code=400, detail=str(error))


# Mount every /api route once the router is fully populated.
app.include_router(router)
