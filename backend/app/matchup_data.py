from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from nba_api.stats.endpoints import (
    leaguedashplayerbiostats,
    leagueseasonmatchups,
    shotchartdetail,
)

from .nba_stats_client import (
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
)


TRACKING_ERA_START_SEASON = 2013
SUFFICIENT_SAMPLE_POSSESSIONS = 50
HEIGHT_BUCKETS = ("guard", "wing", "big", "center")

# No nba_api endpoint supplies zone-level shot data conditioned on defender
# size (see docs/spikes/wo-16-defender-conditioned-zone-data.md). ShotChartDetail
# carries shot locations but no defender filter, so zone_data reflects a player's
# career-average shot distribution against all defenders, not against the
# requested height bucket.
ZONE_DATA_UNCONDITIONED_WARNING = (
    "Zone shot data is not conditioned on defender height; frequencies and "
    "efficiencies reflect career-average shot distribution against all defenders."
)


@dataclass(frozen=True)
class ZoneShotData:
    zone: str
    shot_zone_basic: str
    shot_zone_area: str
    shot_zone_range: str
    fgm: int
    fga: int
    points: int
    frequency: float
    field_goal_percentage: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class MatchupConditionedStats:
    sufficient_sample: bool
    possession_count: int
    fgm: int
    fga: int
    points: int
    free_throw_attempts: int
    turnovers: int
    blocks: int
    zone_data: list[ZoneShotData]
    height_bucket: str
    data_warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["zone_data"] = [zone.to_dict() for zone in self.zone_data]
        return payload


class MatchupDataService:
    def get_matchup_stats(
        self,
        player_id: int,
        height_bucket: str,
    ) -> MatchupConditionedStats:
        normalized_bucket = self._normalize_height_bucket(height_bucket)
        matchup_rows = self._fetch_tracking_matchups(player_id)
        if not matchup_rows:
            return self._empty_stats(normalized_bucket)

        defender_buckets = self._defender_height_index()
        conditioned_rows = [
            row
            for row in matchup_rows
            if defender_buckets.get(self._coerce_player_id(row.get("DEF_PLAYER_ID")))
            == normalized_bucket
        ]

        possession_count = round(
            sum(self._to_float(row.get("PARTIAL_POSS")) for row in conditioned_rows)
        )
        if possession_count <= 0:
            return self._empty_stats(normalized_bucket)

        fgm = round(
            sum(self._to_float(row.get("MATCHUP_FGM")) for row in conditioned_rows)
        )
        fga = round(
            sum(self._to_float(row.get("MATCHUP_FGA")) for row in conditioned_rows)
        )
        points = round(
            sum(self._to_float(row.get("PLAYER_PTS")) for row in conditioned_rows)
        )
        free_throw_attempts = round(
            sum(self._to_float(row.get("MATCHUP_FTA")) for row in conditioned_rows)
        )
        turnovers = round(
            sum(self._to_float(row.get("MATCHUP_TOV")) for row in conditioned_rows)
        )
        blocks = round(
            sum(
                self._to_float(row.get("MATCHUP_BLK"))
                + self._to_float(row.get("HELP_BLK"))
                for row in conditioned_rows
            )
        )
        zone_data = self._fetch_zone_data(player_id)
        data_warnings = [ZONE_DATA_UNCONDITIONED_WARNING] if zone_data else []
        return MatchupConditionedStats(
            sufficient_sample=possession_count >= SUFFICIENT_SAMPLE_POSSESSIONS,
            possession_count=possession_count,
            fgm=fgm,
            fga=fga,
            points=points,
            free_throw_attempts=free_throw_attempts,
            turnovers=turnovers,
            blocks=blocks,
            zone_data=zone_data,
            height_bucket=normalized_bucket,
            data_warnings=data_warnings,
        )

    def _fetch_tracking_matchups(self, player_id: int) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for season in self._tracking_seasons():
            data = fetch_stats_data(
                f"leagueseasonmatchups:{season}:{player_id}",
                lambda season=season: leagueseasonmatchups.LeagueSeasonMatchups(
                    season=self._season_label(season),
                    off_player_id_nullable=player_id,
                    per_mode_simple="Totals",
                    season_type_playoffs="Regular Season",
                    headers=NBA_STATS_HEADERS.copy(),
                    timeout=NBA_STATS_TIMEOUT_SECONDS,
                ),
            )
            rows.extend(data.get("SeasonMatchups", []))
        return rows

    def _fetch_zone_data(
        self,
        player_id: int,
    ) -> list[ZoneShotData]:
        # ShotChartDetail has no defender filter, so the result is identical
        # regardless of the requested height bucket. The cache key omits the
        # bucket so the same player-season is fetched and cached once, not four
        # times. The undifferentiated nature is surfaced via data_warnings.
        rows: list[dict[str, Any]] = []
        for season in self._tracking_seasons():
            data = fetch_stats_data(
                f"shotchartdetail:{season}:{player_id}",
                lambda season=season: shotchartdetail.ShotChartDetail(
                    team_id=0,
                    player_id=player_id,
                    season_nullable=self._season_label(season),
                    season_type_all_star="Regular Season",
                    context_measure_simple="FGA",
                    headers=NBA_STATS_HEADERS.copy(),
                    timeout=NBA_STATS_TIMEOUT_SECONDS,
                ),
            )
            rows.extend(data.get("Shot_Chart_Detail", []))
        return self._aggregate_zone_data(rows)

    def _defender_height_index(self) -> dict[int, str]:
        """Map player_id -> height bucket for every tracking-era player.

        Defender heights are resolved from one bulk LeagueDashPlayerBioStats
        call per season (cached) rather than a per-defender CommonPlayerInfo
        call. A single star can face hundreds of distinct defenders per season,
        so the per-defender approach issued thousands of throttled requests and
        made a simulation effectively never finish.
        """
        index: dict[int, str] = {}
        for season in self._tracking_seasons():
            data = fetch_stats_data(
                f"leaguedashplayerbiostats:{season}",
                lambda season=season: leaguedashplayerbiostats.LeagueDashPlayerBioStats(
                    season=self._season_label(season),
                    headers=NBA_STATS_HEADERS.copy(),
                    timeout=NBA_STATS_TIMEOUT_SECONDS,
                ),
            )
            for row in data.get("LeagueDashPlayerBioStats", []):
                player_id = self._coerce_player_id(row.get("PLAYER_ID"))
                if player_id is None or player_id in index:
                    continue
                height_inches = self._to_float(row.get("PLAYER_HEIGHT_INCHES"))
                if height_inches <= 0:
                    continue
                index[player_id] = self.height_bucket_for_inches(height_inches)
        return index

    @staticmethod
    def _aggregate_zone_data(rows: list[dict[str, Any]]) -> list[ZoneShotData]:
        zones: dict[tuple[str, str, str], dict[str, Any]] = {}
        total_attempts = 0
        for row in rows:
            if MatchupDataService._to_float(row.get("SHOT_ATTEMPTED_FLAG")) <= 0:
                continue

            key = (
                str(row.get("SHOT_ZONE_BASIC") or "Unknown"),
                str(row.get("SHOT_ZONE_AREA") or "Unknown"),
                str(row.get("SHOT_ZONE_RANGE") or "Unknown"),
            )
            zone = zones.setdefault(
                key,
                {
                    "fgm": 0,
                    "fga": 0,
                    "points": 0,
                },
            )
            made = int(MatchupDataService._to_float(row.get("SHOT_MADE_FLAG")) > 0)
            shot_type = str(row.get("SHOT_TYPE") or "")
            point_value = 3 if "3PT" in shot_type.upper() else 2

            zone["fga"] += 1
            zone["fgm"] += made
            zone["points"] += made * point_value
            total_attempts += 1

        zone_data = []
        for key, totals in zones.items():
            basic, area, shot_range = key
            fga = totals["fga"]
            fgm = totals["fgm"]
            zone_data.append(
                ZoneShotData(
                    zone=" | ".join(key),
                    shot_zone_basic=basic,
                    shot_zone_area=area,
                    shot_zone_range=shot_range,
                    fgm=fgm,
                    fga=fga,
                    points=totals["points"],
                    frequency=round(fga / total_attempts, 4) if total_attempts else 0.0,
                    field_goal_percentage=round(fgm / fga, 4) if fga else 0.0,
                )
            )

        return sorted(zone_data, key=lambda zone: zone.fga, reverse=True)

    @staticmethod
    def _tracking_seasons(today: date | None = None) -> list[int]:
        today = today or date.today()
        current_season_start = today.year if today.month >= 10 else today.year - 1
        return list(range(TRACKING_ERA_START_SEASON, current_season_start + 1))

    @staticmethod
    def _season_label(start_year: int) -> str:
        return f"{start_year}-{str(start_year + 1)[-2:]}"

    @staticmethod
    def _normalize_height_bucket(height_bucket: str) -> str:
        normalized = height_bucket.strip().lower()
        if normalized not in HEIGHT_BUCKETS:
            raise ValueError(
                f"height_bucket must be one of {', '.join(HEIGHT_BUCKETS)}"
            )
        return normalized

    @staticmethod
    def height_bucket_for_inches(height_inches: float) -> str:
        if height_inches < 77:
            return "guard"
        if height_inches < 80:
            return "wing"
        if height_inches < 84:
            return "big"
        return "center"

    @staticmethod
    def _coerce_player_id(value: Any) -> int | None:
        try:
            player_id = int(value)
        except (TypeError, ValueError):
            return None
        return player_id if player_id > 0 else None

    @staticmethod
    def _empty_stats(height_bucket: str) -> MatchupConditionedStats:
        return MatchupConditionedStats(
            sufficient_sample=False,
            possession_count=0,
            fgm=0,
            fga=0,
            points=0,
            free_throw_attempts=0,
            turnovers=0,
            blocks=0,
            zone_data=[],
            height_bucket=height_bucket,
        )

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0


matchup_data_service = MatchupDataService()
