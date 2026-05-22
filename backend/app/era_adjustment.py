from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class EraBaseline:
    key: str
    label: str
    start_year: int
    end_year: int
    pace: float
    offensive_rating: float


@dataclass(frozen=True)
class EraAdjustment:
    era_key: str
    era_label: str
    career_start_year: int
    career_end_year: int
    baseline_era_key: str
    pace_multiplier: float
    scoring_environment_multiplier: float
    source_pace: float
    source_offensive_rating: float
    baseline_pace: float
    baseline_offensive_rating: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


ERA_BASELINES: tuple[EraBaseline, ...] = (
    EraBaseline(
        key="early_nba",
        label="Early NBA",
        start_year=1947,
        end_year=1959,
        pace=105.0,
        offensive_rating=83.5,
    ),
    EraBaseline(
        key="pace_and_space_predecessor",
        label="1960s Pace Era",
        start_year=1960,
        end_year=1969,
        pace=120.6,
        offensive_rating=92.8,
    ),
    EraBaseline(
        key="post_merger",
        label="Post-Merger NBA",
        start_year=1970,
        end_year=1979,
        pace=107.8,
        offensive_rating=98.3,
    ),
    EraBaseline(
        key="showtime",
        label="1980s Showtime Era",
        start_year=1980,
        end_year=1989,
        pace=101.6,
        offensive_rating=107.1,
    ),
    EraBaseline(
        key="physical_half_court",
        label="1990s Physical Half-Court Era",
        start_year=1990,
        end_year=1999,
        pace=92.9,
        offensive_rating=105.5,
    ),
    EraBaseline(
        key="dead_ball",
        label="Early 2000s Dead-Ball Era",
        start_year=2000,
        end_year=2009,
        pace=91.0,
        offensive_rating=104.3,
    ),
    EraBaseline(
        key="spacing_transition",
        label="2010s Spacing Transition",
        start_year=2010,
        end_year=2019,
        pace=94.7,
        offensive_rating=107.8,
    ),
    EraBaseline(
        key="modern_spacing",
        label="Modern Spacing Era",
        start_year=2020,
        end_year=2026,
        pace=99.3,
        offensive_rating=113.9,
    ),
)


class EraAdjustmentService:
    def __init__(
        self,
        era_baselines: tuple[EraBaseline, ...] = ERA_BASELINES,
        baseline_era_key: str = "modern_spacing",
    ):
        self.era_baselines = era_baselines
        self.baseline = self._get_era_by_key(baseline_era_key)

    def get_adjustment(
        self,
        career_start_year: int | str | None,
        career_end_year: int | str | None = None,
    ) -> EraAdjustment:
        start_year = self._parse_year(career_start_year)
        end_year = self._parse_year(career_end_year) or start_year

        if start_year is None:
            start_year = self.baseline.start_year
            end_year = self.baseline.end_year
        elif end_year is None:
            end_year = start_year

        if end_year < start_year:
            start_year, end_year = end_year, start_year

        source_era = self._era_for_career(start_year, end_year)

        return EraAdjustment(
            era_key=source_era.key,
            era_label=source_era.label,
            career_start_year=start_year,
            career_end_year=end_year,
            baseline_era_key=self.baseline.key,
            pace_multiplier=round(self.baseline.pace / source_era.pace, 4),
            scoring_environment_multiplier=round(
                self.baseline.offensive_rating / source_era.offensive_rating, 4
            ),
            source_pace=source_era.pace,
            source_offensive_rating=source_era.offensive_rating,
            baseline_pace=self.baseline.pace,
            baseline_offensive_rating=self.baseline.offensive_rating,
        )

    def _get_era_by_key(self, era_key: str) -> EraBaseline:
        for era in self.era_baselines:
            if era.key == era_key:
                return era
        raise ValueError(f"Unknown era baseline: {era_key}")

    def _era_for_career(self, start_year: int, end_year: int) -> EraBaseline:
        best_era = self.era_baselines[0]
        best_overlap = -1
        career_midpoint = (start_year + end_year) / 2

        for era in self.era_baselines:
            overlap_start = max(start_year, era.start_year)
            overlap_end = min(end_year, era.end_year)
            overlap = max(0, overlap_end - overlap_start + 1)
            era_midpoint = (era.start_year + era.end_year) / 2

            if overlap > best_overlap:
                best_era = era
                best_overlap = overlap
                continue

            if overlap == best_overlap and abs(era_midpoint - career_midpoint) < abs(
                (best_era.start_year + best_era.end_year) / 2 - career_midpoint
            ):
                best_era = era

        if best_overlap > 0:
            return best_era

        if end_year < self.era_baselines[0].start_year:
            return self.era_baselines[0]
        return self.era_baselines[-1]

    @staticmethod
    def _parse_year(value: int | str | None) -> int | None:
        if value in (None, "", "NA", "N/A"):
            return None

        try:
            return int(value)
        except (TypeError, ValueError):
            return None


era_adjustment_service = EraAdjustmentService()
