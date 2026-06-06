"""Static era and franchise definitions for the All-Time Draft Challenge.

ADR-003 puts era boundaries and franchise-era eligibility in the API layer so
the spinner only ever offers valid era-franchise combinations and so these edge
cases (relocations, expansions, contractions) live in one place without a client
deploy. The draft pool endpoints (`/api/draft/eras`, `/api/draft/franchises`,
`/api/draft/pool`) are the only consumers.

Two coordinate systems matter here:

* **Era windows** are expressed as season *start* years and are half-open
  ``[start_year, end_year)``, so every season belongs to exactly one era. A
  season id like ``"1996-97"`` has start year 1996, which falls in the 1990s era
  (1989-1999). 1973-74 is the floor because Basketball Reference only publishes
  BPM/VORP from that season on (ADR-001/003).

* **Franchise stints** map a continuous franchise lineage to the Basketball
  Reference team abbreviations it used over time (the `teams` column of
  ``player_advanced_stats.csv`` is in BR's spelling — e.g. ``PHO`` not ``PHX``,
  ``BRK`` not ``BKN``, ``CHO`` for the modern Charlotte Hornets). Pool matching
  unions every stint abbreviation for a franchise; the season's era window
  already prevents anachronistic matches (no one played for ``OKC`` in 1995).
"""

from __future__ import annotations

from dataclasses import dataclass

# Sentinel "present day" upper bound for an ongoing franchise stint.
_PRESENT = 2030


@dataclass(frozen=True)
class DraftEra:
    id: str
    label: str
    start_year: int  # inclusive season start year
    end_year: int  # exclusive season start year


@dataclass(frozen=True)
class FranchiseStint:
    name: str
    abbr: str  # Basketball Reference abbreviation (matches the CSV `teams` column)
    start_year: int  # inclusive season start year
    end_year: int  # exclusive season start year


@dataclass(frozen=True)
class Franchise:
    id: str
    stints: tuple[FranchiseStint, ...]


# 1979-80 through 2024-25 (latest completed season), partitioned into decade
# eras by season start year. (Basketball Reference publishes BPM/VORP from
# 1973-74 on, but the draft challenge starts at the 1980s.)
ERAS: tuple[DraftEra, ...] = (
    DraftEra("1980s", "1980s", 1979, 1989),
    DraftEra("1990s", "1990s", 1989, 1999),
    DraftEra("2000s", "2000s", 1999, 2009),
    DraftEra("2010s", "2010s", 2009, 2019),
    DraftEra("2020s", "2020s", 2019, 2025),
)

_ERA_BY_ID = {era.id: era for era in ERAS}


def _single(franchise_id: str, name: str, abbr: str, start_year: int) -> Franchise:
    """An ongoing franchise that has only ever used one BR abbreviation."""
    return Franchise(franchise_id, (FranchiseStint(name, abbr, start_year, _PRESENT),))


# One entry per continuous franchise lineage. Multi-stint franchises encode
# relocations/renames so the franchises endpoint can surface the era-appropriate
# name (Seattle SuperSonics in the 1990s, Oklahoma City Thunder in the 2010s)
# while pool matching still unions every historical abbreviation.
FRANCHISES: tuple[Franchise, ...] = (
    _single("hawks", "Atlanta Hawks", "ATL", 1968),
    _single("celtics", "Boston Celtics", "BOS", 1946),
    _single("bulls", "Chicago Bulls", "CHI", 1966),
    _single("cavaliers", "Cleveland Cavaliers", "CLE", 1970),
    _single("mavericks", "Dallas Mavericks", "DAL", 1980),
    _single("nuggets", "Denver Nuggets", "DEN", 1976),
    _single("pistons", "Detroit Pistons", "DET", 1957),
    _single("warriors", "Golden State Warriors", "GSW", 1971),
    _single("rockets", "Houston Rockets", "HOU", 1971),
    _single("pacers", "Indiana Pacers", "IND", 1976),
    _single("lakers", "Los Angeles Lakers", "LAL", 1960),
    _single("heat", "Miami Heat", "MIA", 1988),
    _single("bucks", "Milwaukee Bucks", "MIL", 1968),
    _single("timberwolves", "Minnesota Timberwolves", "MIN", 1989),
    _single("knicks", "New York Knicks", "NYK", 1946),
    _single("magic", "Orlando Magic", "ORL", 1989),
    _single("sixers", "Philadelphia 76ers", "PHI", 1963),
    _single("suns", "Phoenix Suns", "PHO", 1968),
    _single("blazers", "Portland Trail Blazers", "POR", 1970),
    _single("spurs", "San Antonio Spurs", "SAS", 1976),
    _single("raptors", "Toronto Raptors", "TOR", 1995),
    Franchise(
        "clippers",
        (
            FranchiseStint("Buffalo Braves", "BUF", 1970, 1978),
            FranchiseStint("San Diego Clippers", "SDC", 1978, 1984),
            FranchiseStint("Los Angeles Clippers", "LAC", 1984, _PRESENT),
        ),
    ),
    Franchise(
        "kings",
        (
            FranchiseStint("Kansas City-Omaha Kings", "KCO", 1972, 1975),
            FranchiseStint("Kansas City Kings", "KCK", 1975, 1985),
            FranchiseStint("Sacramento Kings", "SAC", 1985, _PRESENT),
        ),
    ),
    Franchise(
        "jazz",
        (
            FranchiseStint("New Orleans Jazz", "NOJ", 1974, 1979),
            FranchiseStint("Utah Jazz", "UTA", 1979, _PRESENT),
        ),
    ),
    Franchise(
        "wizards",
        (
            FranchiseStint("Capital Bullets", "CAP", 1973, 1974),
            FranchiseStint("Washington Bullets", "WSB", 1974, 1997),
            FranchiseStint("Washington Wizards", "WAS", 1997, _PRESENT),
        ),
    ),
    Franchise(
        "nets",
        (
            FranchiseStint("New York Nets", "NYN", 1976, 1977),
            FranchiseStint("New Jersey Nets", "NJN", 1977, 2012),
            FranchiseStint("Brooklyn Nets", "BRK", 2012, _PRESENT),
        ),
    ),
    Franchise(
        "thunder",
        (
            FranchiseStint("Seattle SuperSonics", "SEA", 1967, 2008),
            FranchiseStint("Oklahoma City Thunder", "OKC", 2008, _PRESENT),
        ),
    ),
    Franchise(
        "grizzlies",
        (
            FranchiseStint("Vancouver Grizzlies", "VAN", 1995, 2001),
            FranchiseStint("Memphis Grizzlies", "MEM", 2001, _PRESENT),
        ),
    ),
    # The original Charlotte Hornets relocated to New Orleans (2002) and became
    # the Pelicans; this lineage is that franchise.
    Franchise(
        "pelicans",
        (
            FranchiseStint("Charlotte Hornets", "CHH", 1988, 2002),
            FranchiseStint("New Orleans Hornets", "NOH", 2002, 2013),
            FranchiseStint("New Orleans/Oklahoma City Hornets", "NOK", 2005, 2007),
            FranchiseStint("New Orleans Pelicans", "NOP", 2013, _PRESENT),
        ),
    ),
    # The 2004 expansion Bobcats took the Hornets name in 2014 (BR: CHO); this is
    # a distinct franchise from the original Hornets/Pelicans lineage above.
    Franchise(
        "hornets",
        (
            FranchiseStint("Charlotte Bobcats", "CHA", 2004, 2014),
            FranchiseStint("Charlotte Hornets", "CHO", 2014, _PRESENT),
        ),
    ),
)

_FRANCHISE_BY_ID = {franchise.id: franchise for franchise in FRANCHISES}


def get_era(era_id: str) -> DraftEra | None:
    return _ERA_BY_ID.get(era_id)


def get_franchise(franchise_id: str) -> Franchise | None:
    return _FRANCHISE_BY_ID.get(franchise_id)


def list_eras() -> list[dict]:
    return [
        {
            "id": era.id,
            "label": era.label,
            "start_year": era.start_year,
            "end_year": era.end_year,
        }
        for era in ERAS
    ]


def _stint_overlaps_era(stint: FranchiseStint, era: DraftEra) -> bool:
    return stint.start_year < era.end_year and stint.end_year > era.start_year


def _era_stint(franchise: Franchise, era: DraftEra) -> FranchiseStint | None:
    """The franchise's stint most representative of the era.

    When more than one stint overlaps (a relocation mid-era), the latest-starting
    overlapping stint wins so the era's *current* identity is shown.
    """
    overlapping = [s for s in franchise.stints if _stint_overlaps_era(s, era)]
    if not overlapping:
        return None
    return max(overlapping, key=lambda s: s.start_year)


def list_franchises_for_era(era_id: str) -> list[dict]:
    """Franchises that fielded a team during the era, with era-appropriate names.

    Sorted by display name for a stable spinner order.
    """
    era = get_era(era_id)
    if era is None:
        return []
    franchises: list[dict] = []
    for franchise in FRANCHISES:
        stint = _era_stint(franchise, era)
        if stint is None:
            continue
        franchises.append(
            {"id": franchise.id, "name": stint.name, "abbreviation": stint.abbr}
        )
    return sorted(franchises, key=lambda f: f["name"])


def franchise_abbreviations(franchise_id: str) -> set[str]:
    """Every BR abbreviation this franchise has used, for CSV `teams` matching."""
    franchise = get_franchise(franchise_id)
    if franchise is None:
        return set()
    return {stint.abbr for stint in franchise.stints}


def season_start_year(season_id: str) -> int | None:
    """1996-97 -> 1996. Returns None for an unparseable id."""
    prefix = season_id[:4]
    return int(prefix) if prefix.isdigit() else None


def season_in_era(season_id: str, era: DraftEra) -> bool:
    year = season_start_year(season_id)
    return year is not None and era.start_year <= year < era.end_year
