import csv
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from nba_api.stats.static import players
from nba_api.stats.endpoints import commonplayerinfo, draftcombinestats
from nba_api.live.nba.endpoints import scoreboard

from .nba_stats_client import (
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
)
from .simulation import SimulationEngine

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

origins = ["http://localhost:5173", "localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulationRequest(BaseModel):
    player_a_id: int = Field(gt=0)
    player_b_id: int = Field(gt=0)
    seed: int | None = None


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


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


@app.get("/", tags=["root"])
async def read_root() -> dict:
    return {"message": "Welcome to your NBA API backend."}


@app.get("/player/{name}", tags=["nba"])
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


@app.get("/scoreboard", tags=["nba"])
async def get_today_scoreboard():
    try:
        games = scoreboard.ScoreBoard()
        return games.get_dict()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch scoreboard: {str(e)}"
        )


@app.post("/simulate", tags=["iso"])
async def simulate_matchup(request: SimulationRequest):
    if request.player_a_id == request.player_b_id:
        raise HTTPException(status_code=400, detail="Players must be different")

    try:
        engine = SimulationEngine(profile_provider=_get_player_profile_by_id)
        return engine.simulate(
            request.player_a_id,
            request.player_b_id,
            request.seed,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to run simulation: {str(e)}"
        )
