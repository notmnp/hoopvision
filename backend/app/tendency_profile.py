import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from .era_adjustment import EraAdjustmentService, era_adjustment_service
from .matchup_data import (
    HEIGHT_BUCKETS,
    TRACKING_ERA_START_SEASON,
    MatchupConditionedStats,
    MatchupDataService,
    ZoneShotData,
    matchup_data_service,
)
from .player_data import get_player_season_stats


logger = logging.getLogger(__name__)

DEFAULT_MODEL_VERSION = "v2_matchup_conditioned"
MODEL_ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "data"
MODEL_ARTIFACT_PATTERN = "tendency_model_*.joblib"
SHRINKAGE_POSSESSION_TARGET = 200
MAX_OBSERVED_BLEND_WEIGHT = 0.8

HEIGHT_BUCKET_ORDINAL = {
    "guard": 0,
    "wing": 1,
    "big": 2,
    "center": 3,
}

FEATURE_COLUMNS = (
    "height_bucket_ordinal",
    "points_per_game",
    "fga_per_game",
    "three_point_attempt_rate",
    "free_throw_attempt_rate",
    "assist_per_game",
    "turnover_per_game",
    "rebound_per_game",
    "block_per_game",
    "steal_per_game",
    "pace_multiplier",
    "scoring_environment_multiplier",
)

OUTPUT_COLUMNS = (
    "rim_frequency",
    "mid_range_frequency",
    "three_frequency",
    "rim_efficiency",
    "mid_range_efficiency",
    "three_efficiency",
    "foul_drawing_rate",
    "turnover_rate",
    "block_rate",
    "steal_rate",
)

LEAGUE_AVERAGE_FEATURES = {
    "points_per_game": 12.0,
    "fga_per_game": 9.5,
    "three_point_attempt_rate": 0.30,
    "free_throw_attempt_rate": 0.24,
    "assist_per_game": 2.4,
    "turnover_per_game": 1.5,
    "rebound_per_game": 4.5,
    "block_per_game": 0.5,
    "steal_per_game": 0.8,
}

# Per-band league-average split over concrete court zones, used to place shots
# when a player has no real tracking-era shot chart (pre-2013 seasons) or no
# observed attempts in a band. The (basic, area) labels mirror the NBA
# SHOT_ZONE_BASIC / SHOT_ZONE_AREA values the frontend court maps to coordinates;
# weights are relative attempt shares within each band.
LEAGUE_AVERAGE_ZONE_WEIGHTS: dict[str, list[dict[str, Any]]] = {
    "rim": [
        {"basic": "Restricted Area", "area": "Center(C)", "weight": 62.0},
        {"basic": "In The Paint (Non-RA)", "area": "Center(C)", "weight": 16.0},
        {"basic": "In The Paint (Non-RA)", "area": "Left Side(L)", "weight": 11.0},
        {"basic": "In The Paint (Non-RA)", "area": "Right Side(R)", "weight": 11.0},
    ],
    "mid_range": [
        {"basic": "Mid-Range", "area": "Center(C)", "weight": 14.0},
        {"basic": "Mid-Range", "area": "Left Side(L)", "weight": 22.0},
        {"basic": "Mid-Range", "area": "Left Side Center(LC)", "weight": 18.0},
        {"basic": "Mid-Range", "area": "Right Side Center(RC)", "weight": 18.0},
        {"basic": "Mid-Range", "area": "Right Side(R)", "weight": 22.0},
    ],
    "three": [
        {"basic": "Above the Break 3", "area": "Center(C)", "weight": 30.0},
        {"basic": "Above the Break 3", "area": "Left Side Center(LC)", "weight": 24.0},
        {"basic": "Above the Break 3", "area": "Right Side Center(RC)", "weight": 24.0},
        {"basic": "Left Corner 3", "area": "Left Side(L)", "weight": 11.0},
        {"basic": "Right Corner 3", "area": "Right Side(R)", "weight": 11.0},
    ],
}

SHOT_LOCATION_FALLBACK_WARNING = (
    "Shot locations are illustrative league-average placements; the NBA "
    "published no shot-tracking data for this season, so exact spots are not "
    "drawn from this player's real shot chart."
)


@dataclass(frozen=True)
class TendencyProfile:
    player_id: int
    model_version: str
    shot_type_distribution: dict[str, float]
    scoring_efficiency_by_shot_type: dict[str, float]
    foul_drawing_rate: float
    turnover_rate: float
    era_adjustment: dict[str, Any]
    data_warnings: list[str]
    block_rate: float = 0.04
    steal_rate: float = 0.06
    confidence_tier: str = "MEDIUM"
    height_bucket: str = "wing"
    matchup_possession_count: int = 0
    observed_blend_weight: float = 0.0
    # band ("rim"/"mid_range"/"three") -> [{"basic", "area", "weight"}, ...],
    # the per-band court-zone distribution the simulation samples a shot location
    # from. Defaults empty so a profile without it places no location (and the
    # simulation consumes no RNG for it).
    shot_zone_weights: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ArtifactBackedTendencyModel:
    def __init__(self, artifact: dict[str, Any]):
        self.artifact = artifact
        self.model = artifact["model"]
        self.metadata = artifact.get("metadata", {})
        self.model_version = self.metadata.get("model_version", DEFAULT_MODEL_VERSION)

    def predict(self, features: dict[str, float]) -> dict[str, float]:
        feature_columns = tuple(self.metadata.get("feature_columns", FEATURE_COLUMNS))
        target_columns = tuple(self.metadata.get("target_columns", OUTPUT_COLUMNS))
        feature_vector = np.array([[features[column] for column in feature_columns]])
        prediction = self.model.predict(feature_vector)[0]
        return dict(zip(target_columns, prediction, strict=True))


def load_tendency_model(
    artifact_dir: Path = MODEL_ARTIFACT_DIR,
) -> ArtifactBackedTendencyModel:
    artifact_path = _latest_artifact_path(artifact_dir)
    artifact = joblib.load(artifact_path)
    model = ArtifactBackedTendencyModel(artifact)
    calibration_report = model.metadata.get("calibration_report", {})
    logger.info(
        "Loaded tendency model artifact %s version=%s calibration=%s",
        artifact_path,
        model.model_version,
        calibration_report,
    )
    return model


def _latest_artifact_path(artifact_dir: Path) -> Path:
    artifacts = sorted(artifact_dir.glob(MODEL_ARTIFACT_PATTERN))
    if not artifacts:
        raise FileNotFoundError(
            f"No tendency model artifact found in {artifact_dir}. "
            "Run backend/scripts/train_tendency_model.py first."
        )
    return artifacts[-1]


class TendencyProfileBuilder:
    def __init__(
        self,
        model: ArtifactBackedTendencyModel | Any | None = None,
        era_service: EraAdjustmentService = era_adjustment_service,
        matchup_service: MatchupDataService = matchup_data_service,
    ):
        self.model = model or load_tendency_model()
        self.era_service = era_service
        self.matchup_service = matchup_service

    def build_profile(
        self,
        player_id: int,
        height_bucket: str | None = "wing",
        season_id: str | None = None,
    ) -> TendencyProfile:
        height_bucket = self._normalize_height_bucket(height_bucket)
        season_year = self._parse_season_year(season_id)
        fetch_warning = None
        season_stats = None
        try:
            if season_id is not None:
                season_stats = self._fetch_season_stats(player_id, season_id)
        except Exception as error:
            season_stats = None
            fetch_warning = (
                "NBA Stats season lookup failed, so league-average tendency "
                f"inputs were substituted: {error}"
            )

        features, era_adjustment, data_warnings = self._build_model_input(
            season_stats,
            height_bucket,
            season_year,
        )
        if fetch_warning:
            data_warnings.insert(0, fetch_warning)

        prediction = self._predict(features)
        # Observed matchup data only exists for tracking-era seasons (2013+);
        # for an earlier selected season the model-only profile is used.
        post_tracking_player = (
            season_year is not None and season_year >= TRACKING_ERA_START_SEASON
        )
        observed_stats = None
        if post_tracking_player:
            try:
                # Scope observed data to the selected season only. season_year is
                # guaranteed non-None here by the post_tracking_player guard
                # above (keep this call inside that guard). Aggregating every
                # tracking season would issue ~13x more throttled upstream calls
                # per player and time out on cold serverless starts.
                observed_stats = self.matchup_service.get_matchup_stats(
                    player_id,
                    height_bucket,
                    seasons=[season_year],
                )
            except Exception as error:
                data_warnings.append(
                    "Observed matchup data could not be loaded, so the model-only "
                    f"profile was used: {error}"
                )

        if observed_stats:
            data_warnings.extend(observed_stats.data_warnings)

        observed_weight = 0.0
        if observed_stats and observed_stats.possession_count > 0:
            observed_output = self._observed_output(observed_stats, features)
            observed_weight = self._observed_weight(observed_stats.possession_count)
            prediction = self._blend_outputs(
                prediction, observed_output, observed_weight
            )

        confidence_tier = self._confidence_tier(
            post_tracking_player,
            observed_stats.possession_count if observed_stats else 0,
            features,
        )
        if confidence_tier != "HIGH":
            data_warnings.append(
                f"Tendency profile confidence is {confidence_tier}; simulation accuracy may be limited."
            )

        shot_distribution = self._normalize_distribution(
            {
                "rim": prediction["rim_frequency"],
                "mid_range": prediction["mid_range_frequency"],
                "three": prediction["three_frequency"],
            }
        )

        # Carry the player's real per-zone shot distribution onto the profile so
        # the simulation can place each shot where the player actually took it.
        # When no real shot chart exists (pre-tracking or no observed data) the
        # league-average split stands in and the substitution is disclosed.
        zone_data = observed_stats.zone_data if observed_stats else []
        shot_zone_weights, had_real_zone_data = self._build_shot_zone_weights(zone_data)
        if not had_real_zone_data:
            data_warnings.append(SHOT_LOCATION_FALLBACK_WARNING)

        return TendencyProfile(
            player_id=player_id,
            model_version=getattr(self.model, "model_version", DEFAULT_MODEL_VERSION),
            shot_type_distribution=shot_distribution,
            scoring_efficiency_by_shot_type={
                "rim": self._clamp(prediction["rim_efficiency"], 0.45, 0.85),
                "mid_range": self._clamp(
                    prediction["mid_range_efficiency"], 0.30, 0.60
                ),
                "three": self._clamp(prediction["three_efficiency"], 0.20, 0.50),
            },
            foul_drawing_rate=self._clamp(prediction["foul_drawing_rate"], 0.03, 0.30),
            turnover_rate=self._clamp(prediction["turnover_rate"], 0.04, 0.24),
            block_rate=self._clamp(prediction["block_rate"], 0.0, 0.30),
            steal_rate=self._clamp(prediction["steal_rate"], 0.0, 0.30),
            era_adjustment=era_adjustment.to_dict(),
            data_warnings=data_warnings,
            confidence_tier=confidence_tier,
            height_bucket=height_bucket,
            matchup_possession_count=(
                observed_stats.possession_count if observed_stats else 0
            ),
            observed_blend_weight=observed_weight,
            shot_zone_weights=shot_zone_weights,
        )

    def _build_model_input(
        self,
        season_stats: dict[str, Any] | None,
        height_bucket: str,
        season_year: int | None,
    ) -> tuple[dict[str, float], Any, list[str]]:
        features, data_warnings = self._extract_features(season_stats)
        # A single season belongs to exactly one era, so the season's start year
        # is passed for both ends of the adjustment lookup.
        era_adjustment = self.era_service.get_adjustment(season_year, season_year)
        features["height_bucket_ordinal"] = float(HEIGHT_BUCKET_ORDINAL[height_bucket])
        features["pace_multiplier"] = era_adjustment.pace_multiplier
        features["scoring_environment_multiplier"] = (
            era_adjustment.scoring_environment_multiplier
        )
        return features, era_adjustment, data_warnings

    def _predict(self, features: dict[str, float]) -> dict[str, float]:
        prediction = self.model.predict(features)
        if isinstance(prediction, dict):
            return {column: float(prediction[column]) for column in OUTPUT_COLUMNS}
        return dict(zip(OUTPUT_COLUMNS, prediction, strict=True))

    def _fetch_season_stats(
        self, player_id: int, season_id: str
    ) -> dict[str, Any] | None:
        return get_player_season_stats(player_id, season_id)

    def _extract_features(
        self, season_stats: dict[str, Any] | None
    ) -> tuple[dict[str, float], list[str]]:
        data_warnings: list[str] = []

        if not season_stats:
            data_warnings.append(
                "League-average tendency inputs substituted because no regular-season stats were found."
            )
            return {
                **LEAGUE_AVERAGE_FEATURES,
                "height_bucket_ordinal": 1.0,
                "pace_multiplier": 1.0,
                "scoring_environment_multiplier": 1.0,
            }, data_warnings

        features = {
            "points_per_game": float(season_stats["points_per_game"]),
            "fga_per_game": float(season_stats["fga_per_game"]),
            "three_point_attempt_rate": float(season_stats["three_point_attempt_rate"]),
            "free_throw_attempt_rate": float(season_stats["free_throw_attempt_rate"]),
            "assist_per_game": float(season_stats["assist_per_game"]),
            "turnover_per_game": float(season_stats["turnover_per_game"]),
            "rebound_per_game": float(season_stats["rebound_per_game"]),
            "block_per_game": float(season_stats["block_per_game"]),
            "steal_per_game": float(season_stats["steal_per_game"]),
            "height_bucket_ordinal": 1.0,
            "pace_multiplier": 1.0,
            "scoring_environment_multiplier": 1.0,
        }

        for feature_name, fallback_value in LEAGUE_AVERAGE_FEATURES.items():
            if features[feature_name] == 0:
                features[feature_name] = fallback_value
                data_warnings.append(
                    f"League-average {feature_name} substituted because player data was missing or zero."
                )

        return features, data_warnings

    @classmethod
    def _observed_output(
        cls,
        matchup_stats: MatchupConditionedStats,
        features: dict[str, float],
    ) -> dict[str, float]:
        zone_output = cls._zone_output(matchup_stats.zone_data)
        possessions = max(1, matchup_stats.possession_count)
        fga = max(1, matchup_stats.fga)
        return {
            **zone_output,
            "foul_drawing_rate": cls._clamp(
                matchup_stats.free_throw_attempts / fga, 0.0, 1.0
            ),
            "turnover_rate": cls._clamp(
                matchup_stats.turnovers / possessions, 0.0, 1.0
            ),
            "block_rate": cls._clamp(matchup_stats.blocks / fga, 0.0, 1.0),
            # steal_rate retains the career-average proxy (career steals/game
            # normalized by ~12 possessions). Spike (WO-24): LeagueSeasonMatchups
            # exposes no steals column at all — its defensive fields are only
            # MATCHUP_BLK and HELP_BLK (blocks) plus MATCHUP_TOV (the offensive
            # player's turnovers); there is no MATCHUP_STL or equivalent.
            # Moreover, these rows are queried with the player as the OFFENSIVE
            # player, so any steal figure would describe the defender stripping
            # this player, not this player's own defensive steals. The player's
            # own career steal rate is therefore the more faithful source for a
            # defensive steal_rate, and the proxy is retained as a permanent
            # constraint.
            "steal_rate": cls._clamp(features["steal_per_game"] / 12.0, 0.0, 1.0),
        }

    @classmethod
    def _zone_output(cls, zone_data: list[ZoneShotData]) -> dict[str, float]:
        grouped = {
            "rim": {"fga": 0, "fgm": 0},
            "mid_range": {"fga": 0, "fgm": 0},
            "three": {"fga": 0, "fgm": 0},
        }
        for zone in zone_data:
            shot_type = cls._shot_type_from_zone(zone)
            grouped[shot_type]["fga"] += zone.fga
            grouped[shot_type]["fgm"] += zone.fgm

        total_fga = sum(bucket["fga"] for bucket in grouped.values())
        if total_fga <= 0:
            return {
                "rim_frequency": 0.34,
                "mid_range_frequency": 0.33,
                "three_frequency": 0.33,
                "rim_efficiency": 0.62,
                "mid_range_efficiency": 0.42,
                "three_efficiency": 0.36,
            }

        return {
            "rim_frequency": round(grouped["rim"]["fga"] / total_fga, 4),
            "mid_range_frequency": round(grouped["mid_range"]["fga"] / total_fga, 4),
            "three_frequency": round(grouped["three"]["fga"] / total_fga, 4),
            "rim_efficiency": cls._efficiency(grouped["rim"]),
            "mid_range_efficiency": cls._efficiency(grouped["mid_range"]),
            "three_efficiency": cls._efficiency(grouped["three"]),
        }

    @classmethod
    def _build_shot_zone_weights(
        cls, zone_data: list[ZoneShotData]
    ) -> tuple[dict[str, list[dict[str, Any]]], bool]:
        # Group the real shot chart into per-band court-zone weights. Returns the
        # weights plus whether ANY real zone was found; when a band has no real
        # attempts (or none exist at all) the league-average split fills it so the
        # simulation can always place a shot.
        weights: dict[str, list[dict[str, Any]]] = {
            "rim": [],
            "mid_range": [],
            "three": [],
        }
        for zone in zone_data:
            if zone.fga <= 0:
                continue
            band = cls._shot_type_from_zone(zone)
            weights[band].append(
                {
                    "basic": zone.shot_zone_basic,
                    "area": zone.shot_zone_area,
                    "weight": float(zone.fga),
                }
            )

        had_real_zone_data = any(entries for entries in weights.values())
        for band, entries in weights.items():
            if not entries:
                weights[band] = [
                    dict(entry) for entry in LEAGUE_AVERAGE_ZONE_WEIGHTS[band]
                ]
        return weights, had_real_zone_data

    @staticmethod
    def _shot_type_from_zone(zone: ZoneShotData) -> str:
        text = " ".join(
            (zone.shot_zone_basic, zone.shot_zone_area, zone.shot_zone_range)
        ).lower()
        if "3" in text or "24+" in text:
            return "three"
        if "restricted area" in text or "paint" in text or "less than 8" in text:
            return "rim"
        return "mid_range"

    @staticmethod
    def _blend_outputs(
        model_output: dict[str, float],
        observed_output: dict[str, float],
        observed_weight: float,
    ) -> dict[str, float]:
        model_weight = 1.0 - observed_weight
        return {
            column: round(
                model_output[column] * model_weight
                + observed_output[column] * observed_weight,
                4,
            )
            for column in OUTPUT_COLUMNS
        }

    @staticmethod
    def _observed_weight(possession_count: int) -> float:
        return round(
            min(
                possession_count / SHRINKAGE_POSSESSION_TARGET,
                MAX_OBSERVED_BLEND_WEIGHT,
            ),
            4,
        )

    @staticmethod
    def _confidence_tier(
        post_tracking_player: bool,
        possession_count: int,
        features: dict[str, float],
    ) -> str:
        at_distribution_boundary = (
            features["points_per_game"] >= 35
            or features["fga_per_game"] >= 26
            or features["rebound_per_game"] >= 18
            or features["block_per_game"] >= 5
        )
        if possession_count >= 100 and not at_distribution_boundary:
            return "HIGH"
        if post_tracking_player and not at_distribution_boundary:
            return "MEDIUM"
        return "LOW"

    @staticmethod
    def _normalize_height_bucket(height_bucket: str | None) -> str:
        if height_bucket is None:
            return "wing"
        normalized_bucket = str(height_bucket).strip().lower()
        if normalized_bucket not in HEIGHT_BUCKETS:
            raise ValueError(
                f"height_bucket must be one of {', '.join(HEIGHT_BUCKETS)}"
            )
        return normalized_bucket

    @staticmethod
    def _parse_season_year(season_id: str | None) -> int | None:
        if not season_id:
            return None
        prefix = str(season_id)[:4]
        return int(prefix) if prefix.isdigit() else None

    @staticmethod
    def _efficiency(values: dict[str, int]) -> float:
        if values["fga"] <= 0:
            return 0.0
        return round(values["fgm"] / values["fga"], 4)

    @staticmethod
    def _normalize_distribution(values: dict[str, float]) -> dict[str, float]:
        clamped = {
            key: TendencyProfileBuilder._clamp(value, 0.01, 0.98)
            for key, value in values.items()
        }
        total = sum(clamped.values())
        normalized = {key: round(value / total, 4) for key, value in clamped.items()}
        rounding_delta = round(1.0 - sum(normalized.values()), 4)
        normalized["rim"] = round(normalized["rim"] + rounding_delta, 4)
        return normalized

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return round(max(minimum, min(maximum, float(value))), 4)


tendency_profile_builder = TendencyProfileBuilder()
