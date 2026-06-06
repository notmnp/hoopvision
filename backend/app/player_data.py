"""Per-season player stats sourced from nba_api player dashboards.

This module is the single source of truth for season listing and per-season
stat assembly. The API Server exposes the HTTP endpoints (`GET
/player/{id}/seasons`, `GET /player/{id}/season/{season_id}`) on top of these
functions, and both `TendencyProfileBuilder` and `TendencyModelTrainer` consume
the same per-season feature assembly so the training corpus and live simulation
inputs are built identically. It deliberately avoids importing `api.py` to keep
the dependency graph acyclic (api -> simulation -> tendency_profile ->
player_data).
"""

from typing import Any

from nba_api.stats.endpoints import playercareerstats

from .nba_stats_client import (
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
    nba_stats_proxy,
)


# Per-game feature columns consumed by TendencyProfileBuilder. Kept here so the
# season-stats payload, the live profile inputs, and the training corpus all
# agree on the same set of fields.
SEASON_STAT_COLUMNS = (
    "points_per_game",
    "fga_per_game",
    "three_point_attempt_rate",
    "free_throw_attempt_rate",
    "assist_per_game",
    "turnover_per_game",
    "rebound_per_game",
    "block_per_game",
    "steal_per_game",
)

_TOTAL_COLUMNS = (
    "GP",
    "PTS",
    "FGM",
    "FGA",
    "FG3A",
    "FTA",
    "FTM",
    "AST",
    "TOV",
    "REB",
    "BLK",
    "STL",
    "PF",
)


def fetch_career_season_rows(player_id: int) -> list[dict[str, Any]]:
    """Fetch a player's regular-season totals rows with per-request caching.

    Shares the `playercareerstats:{id}:totals` cache key with the tendency
    profile and trainer fetches so a single NBA Stats call serves all of them.
    """
    data = fetch_stats_data(
        f"playercareerstats:{player_id}:totals",
        lambda: playercareerstats.PlayerCareerStats(
            player_id=player_id,
            headers=NBA_STATS_HEADERS.copy(),
            timeout=NBA_STATS_TIMEOUT_SECONDS,
            proxy=nba_stats_proxy(),
        ),
    )
    return data.get("SeasonTotalsRegularSeason", [])


def aggregate_season_totals(
    season_rows: list[dict[str, Any]]
) -> dict[str, dict[str, float]]:
    """Group regular-season rows by SEASON_ID into a single totals dict each.

    A player traded mid-season has one row per team plus a "TOT" row carrying
    the combined totals; using "TOT" when present avoids double counting. When
    no "TOT" row exists the per-team rows are summed.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in season_rows:
        season_id = _season_id(row)
        if season_id is None:
            continue
        grouped.setdefault(season_id, []).append(row)

    totals_by_season: dict[str, dict[str, float]] = {}
    for season_id, rows in grouped.items():
        tot_rows = [
            row for row in rows if str(row.get("TEAM_ABBREVIATION") or "") == "TOT"
        ]
        source_rows = tot_rows or rows
        totals_by_season[season_id] = {
            column: sum(_to_float(row.get(column)) for row in source_rows)
            for column in _TOTAL_COLUMNS
        }
    return totals_by_season


def season_stats_from_totals(
    season_id: str,
    totals: dict[str, float],
    team_id: int = 0,
    team_abbreviation: str = "",
) -> dict[str, Any]:
    """Build the per-game season stat payload from a season's combined totals."""
    games = totals.get("GP", 0) or 0
    season_year = _season_start_year(season_id)
    return {
        "season_id": season_id,
        "season_label": season_id,
        "season_year": season_year,
        "team_id": team_id,
        "team_abbreviation": team_abbreviation,
        "points_per_game": _per_game(totals.get("PTS"), games),
        "fga_per_game": _per_game(totals.get("FGA"), games),
        "field_goal_percentage": _safe_rate(totals.get("FGM"), totals.get("FGA")),
        "three_point_attempt_rate": _safe_rate(totals.get("FG3A"), totals.get("FGA")),
        "free_throw_attempt_rate": _safe_rate(totals.get("FTA"), totals.get("FGA")),
        "assist_per_game": _per_game(totals.get("AST"), games),
        "turnover_per_game": _per_game(totals.get("TOV"), games),
        "rebound_per_game": _per_game(totals.get("REB"), games),
        "block_per_game": _per_game(totals.get("BLK"), games),
        "steal_per_game": _per_game(totals.get("STL"), games),
        "personal_foul_per_game": _per_game(totals.get("PF"), games),
        # True shooting accounts for 3s and free throws: PTS / (2 * (FGA + 0.44*FTA)).
        "true_shooting_pct": _safe_rate(
            totals.get("PTS"),
            2 * (_to_float(totals.get("FGA")) + 0.44 * _to_float(totals.get("FTA"))),
        ),
        "free_throw_pct": _safe_rate(totals.get("FTM"), totals.get("FTA")),
    }


def _primary_team(
    season_rows: list[dict[str, Any]], season_id: str
) -> tuple[int, str]:
    """Resolve the team a player most represented in a season.

    For a season split across teams (a "TOT" combined row plus per-team rows),
    the team the player logged the most games for is used for branding, since
    "TOT" itself has no team identity (TEAM_ID 0).
    """
    rows = [row for row in season_rows if _season_id(row) == season_id]
    team_rows = [
        row for row in rows if str(row.get("TEAM_ABBREVIATION") or "") != "TOT"
    ]
    candidates = team_rows or rows
    if not candidates:
        return 0, ""
    best = max(candidates, key=lambda row: _to_float(row.get("GP")))
    return (
        int(_to_float(best.get("TEAM_ID"))),
        str(best.get("TEAM_ABBREVIATION") or ""),
    )


def list_player_seasons(player_id: int) -> list[dict[str, str]]:
    """Return `{season_id, season_label}` for each regular season, newest first."""
    season_rows = fetch_career_season_rows(player_id)
    totals_by_season = aggregate_season_totals(season_rows)
    seasons = [
        {"season_id": season_id, "season_label": season_id}
        for season_id in totals_by_season
    ]
    return sorted(seasons, key=lambda season: season["season_id"], reverse=True)


def get_player_season_stats(player_id: int, season_id: str) -> dict[str, Any] | None:
    """Return the per-game `PlayerSeasonStats` payload for one season, or None.

    None signals that the player has no regular-season row for `season_id`.
    """
    season_rows = fetch_career_season_rows(player_id)
    totals_by_season = aggregate_season_totals(season_rows)
    totals = totals_by_season.get(season_id)
    if totals is None:
        return None
    team_id, team_abbreviation = _primary_team(season_rows, season_id)
    return season_stats_from_totals(season_id, totals, team_id, team_abbreviation)


def _season_id(row: dict[str, Any]) -> str | None:
    season_id = str(row.get("SEASON_ID") or "").strip()
    return season_id or None


def _season_start_year(season_id: str) -> int:
    prefix = str(season_id)[:4]
    if prefix.isdigit():
        return int(prefix)
    raise ValueError(f"Unparseable season_id: {season_id!r}")


def _per_game(value: Any, games: float) -> float:
    if not games or games <= 0:
        return 0.0
    return round(_to_float(value) / games, 4)


def _safe_rate(numerator: Any, denominator: Any) -> float:
    denominator_value = _to_float(denominator)
    if denominator_value <= 0:
        return 0.0
    return round(_to_float(numerator) / denominator_value, 4)


def _to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0
