"""Season-scoped shot chart data sourced from nba_api ShotChartDetail.

`ShotChartService` backs `GET /shotchart/{player_id}/{season}`. Per ADR-001 it is
deliberately season-scoped and independent of `MatchupDataService` (which
aggregates ShotChartDetail across all tracking-era seasons for the tendency
model and cannot be reused here). It shares the same TTL cache as
`PlayerDataService` via `fetch_stats_data`.

Shot location tracking only exists from the 2013-14 season onward; earlier
seasons return `available: false` with an explanatory warning rather than an
error or an empty chart (AC-TE-002.4).
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from nba_api.stats.endpoints import shotchartdetail

from .nba_stats_client import (
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
)


TRACKING_ERA_START_SEASON = 2013


def _tracking_era_warning(season_id: str) -> str:
    return (
        f"Shot location data is unavailable for the {season_id} season. The NBA "
        "only began publishing shot-tracking data in the 2013-14 season, so no "
        "shot chart exists for earlier seasons."
    )


@dataclass(frozen=True)
class ShotZone:
    zone_label: str
    zone_area: str
    attempts: int
    made: int
    fg_pct: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ShotChartData:
    available: bool
    zones: list[ShotZone]
    data_warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "zones": [zone.to_dict() for zone in self.zones],
            "data_warnings": list(self.data_warnings),
        }


class ShotChartService:
    def get_shot_chart(self, player_id: int, season_id: str) -> ShotChartData:
        # Pre-tracking-era seasons have no shot data at all; short-circuit with a
        # warning rather than spending a throttled call on a guaranteed-empty
        # response.
        if self._is_pre_tracking_era(season_id):
            return ShotChartData(
                available=False,
                zones=[],
                data_warnings=[_tracking_era_warning(season_id)],
            )

        rows = self._fetch_shot_rows(player_id, season_id)
        zones = self._aggregate_zones(rows)
        if not zones:
            # A tracking-era season with no rows (e.g. the player logged no shots
            # that year) is still surfaced as unavailable, not a broken chart.
            return ShotChartData(
                available=False,
                zones=[],
                data_warnings=[_tracking_era_warning(season_id)],
            )

        return ShotChartData(available=True, zones=zones, data_warnings=[])

    def _fetch_shot_rows(self, player_id: int, season_id: str) -> list[dict[str, Any]]:
        data = fetch_stats_data(
            f"shotchart:{player_id}:{season_id}",
            lambda: shotchartdetail.ShotChartDetail(
                team_id=0,
                player_id=player_id,
                season_nullable=season_id,
                season_type_all_star="Regular Season",
                context_measure_simple="FGA",
                headers=NBA_STATS_HEADERS.copy(),
                timeout=NBA_STATS_TIMEOUT_SECONDS,
            ),
        )
        return data.get("Shot_Chart_Detail", [])

    @staticmethod
    def _aggregate_zones(rows: list[dict[str, Any]]) -> list[ShotZone]:
        # Group shots by (basic zone, court area) — e.g. ("Mid-Range",
        # "Left Side(L)") — and tally attempts / makes per zone.
        zones: dict[tuple[str, str], dict[str, int]] = {}
        for row in rows:
            if ShotChartService._to_float(row.get("SHOT_ATTEMPTED_FLAG")) <= 0:
                continue
            key = (
                str(row.get("SHOT_ZONE_BASIC") or "Unknown"),
                str(row.get("SHOT_ZONE_AREA") or "Unknown"),
            )
            zone = zones.setdefault(key, {"attempts": 0, "made": 0})
            zone["attempts"] += 1
            if ShotChartService._to_float(row.get("SHOT_MADE_FLAG")) > 0:
                zone["made"] += 1

        shot_zones = [
            ShotZone(
                zone_label=label,
                zone_area=area,
                attempts=totals["attempts"],
                made=totals["made"],
                fg_pct=(
                    round(totals["made"] / totals["attempts"], 4)
                    if totals["attempts"]
                    else 0.0
                ),
            )
            for (label, area), totals in zones.items()
        ]
        return sorted(shot_zones, key=lambda zone: zone.attempts, reverse=True)

    @staticmethod
    def _is_pre_tracking_era(season_id: str) -> bool:
        start_year = ShotChartService._season_start_year(season_id)
        if start_year is None:
            return False
        return start_year < TRACKING_ERA_START_SEASON

    @staticmethod
    def _season_start_year(season_id: str) -> int | None:
        prefix = str(season_id)[:4]
        return int(prefix) if prefix.isdigit() else None

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0


shot_chart_service = ShotChartService()
