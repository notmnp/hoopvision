#!/usr/bin/env python3
"""Compile ``backend/data/player_advanced_stats.csv`` from Basketball Reference.

This is the bundled static advanced-metrics dataset described in the All-Time
Draft Challenge blueprint (ADR-001). It is the primary input for both
``PlayerPoolResolver`` (pool ranking / display) and ``DraftScoringEngine``
(scoring formula). WS/48, BPM, and VORP are Basketball Reference metrics that
the NBA Stats API does not expose, so — like ``nba_wingspan_performance_2025.csv``
— we pre-compile them once and commit the result to the repo.

This is a MANUAL off-season refresh task, not an automated pipeline. Re-run it
after each completed regular season to pick up the new year:

    python backend/scripts/compile_advanced_stats.py            # 1973-74 .. latest default
    python backend/scripts/compile_advanced_stats.py --last 2025
    python backend/scripts/compile_advanced_stats.py --first 1974 --last 2025 --min-minutes 500

For each season it downloads the league "Advanced" table
(``https://www.basketball-reference.com/leagues/NBA_{year}_advanced.html``),
keeps players with at least ``--min-minutes`` minutes, and resolves each
Basketball Reference player to an nba_api integer ``player_id``.

ID mapping (the "name + team + year" join the work order calls for): the only
stable join key shared by both sources is the player name, so we normalise names
(accent-folded, punctuation-stripped — matching ``backend/app/api.py``) and join
against the nba_api static player index. Namesakes (father/son pairs such as
Patrick Ewing / Patrick Ewing Jr, Glen Rice / Glen Rice Jr, Tim Hardaway / Tim
Hardaway Jr) collide on name. Basketball Reference disambiguates them with a
per-player slug (``ewingpa01`` vs ``ewingpa02``) whose numeric suffix is assigned
chronologically; nba_api integer ids are likewise roughly chronological. So when
a name maps to N Basketball Reference slugs AND N nba_api ids, we pair them in
order (oldest slug -> smallest id) — this is the "year" dimension of the join,
resolved offline without any live NBA Stats call (those require a proxy that is
not configured for this script). When the slug count and id count disagree the
join is AMBIGUOUS: those rows are dropped from the committed CSV and reported on
stderr for manual review, because guessing an id is worse than omitting the row
(a missing row simply yields no advanced metrics downstream, whereas a wrong id
mislabels a player). Coverage of well-known players across eras is validated
before the file is written.

CSV columns (one row per player-season):
    player_id    nba_api integer id
    player_name  display name (Basketball Reference)
    season_id    e.g. "1996-97"
    pos          Basketball Reference position(s) for the season (e.g. "SG", "PF-C")
    teams        ";"-joined franchise abbreviation(s) the player logged minutes for
                 that season (e.g. "CHI" or "PHI;NYK" for a mid-season trade). Lets
                 PlayerPoolResolver resolve franchise+era membership directly from
                 the bundled data instead of live NBA-Stats roster calls.
    mp           total regular-season minutes played
    ws_per_48    win shares per 48 minutes
    bpm          box plus/minus
    vorp         value over replacement player
    ts_pct       true shooting percentage
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from nba_api.stats.static import players as nba_players

# 1973-74 is the first season Basketball Reference publishes BPM/VORP, so it is
# the practical lower boundary (matches the era spinner's 1970s start, ADR-003).
FIRST_SEASON_END_YEAR = 1974
# Most recent completed regular season (season ending in this calendar year).
DEFAULT_LAST_SEASON_END_YEAR = 2025
# Minimum minutes played in a season for the player-season to be included.
DEFAULT_MIN_MINUTES = 500

ADVANCED_URL = "https://www.basketball-reference.com/leagues/NBA_{year}_advanced.html"

# Browser-like headers; Basketball Reference's CDN rejects bare clients.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

# Basketball Reference rate-limits aggressively (HTTP 429 + temporary ban above
# ~20 requests/minute). Space requests well clear of that ceiling.
REQUEST_DELAY_SECONDS = 4.0
MAX_RETRIES = 4

OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "player_advanced_stats.csv"

CSV_FIELDS = [
    "player_id",
    "player_name",
    "season_id",
    "pos",
    "teams",
    "mp",
    "ws_per_48",
    "bpm",
    "vorp",
    "ts_pct",
]

# Well-known players whose presence is asserted before the CSV is written, so a
# silent scrape regression (layout change, blocked requests) is caught early.
VALIDATION_PLAYERS = [
    "Kareem Abdul-Jabbar",
    "Julius Erving",
    "Magic Johnson",
    "Larry Bird",
    "Michael Jordan",
    "Hakeem Olajuwon",
    "Shaquille O'Neal",
    "Kobe Bryant",
    "Tim Duncan",
    "LeBron James",
    "Stephen Curry",
    "Nikola Jokic",
]

# Basketball Reference marks a combined (full-season) row for a traded player
# with one of these in the team column.
_COMBINED_TEAM = re.compile(r"TOT|\dTM")


# Generational suffixes that one source includes and the other often omits
# (Basketball Reference writes "Glen Rice Jr." while nba_api stores plain "Glen
# Rice"). Stripped from the join key so namesakes group identically in both.
_SUFFIX_TOKENS = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str) -> str:
    """Accent-fold + strip punctuation, matching ``api._normalize_name``."""
    decomposed = unicodedata.normalize("NFKD", str(name))
    ascii_name = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", ascii_name.lower()).strip()


def join_key(name: str) -> str:
    """Source-agnostic join key: accent-folded, suffix-stripped, separator-free.

    Removes generational suffixes (Jr/Sr/II/III/...) and all separators so the
    same player keys identically whether a source writes "J.R. Smith" / "JR
    Smith" or "Glen Rice Jr." / "Glen Rice". Namesakes (e.g. father/son) still
    collide on the key by design — they are separated afterwards by pairing
    chronological Basketball Reference slugs with ascending nba_api ids.
    """
    tokens = [t for t in normalize_name(name).split() if t not in _SUFFIX_TOKENS]
    return "".join(tokens)


def build_name_index() -> dict[str, list[int]]:
    """Map player join key -> ascending list of nba_api integer ids.

    Ids are sorted ascending so they pair with chronologically-ordered
    Basketball Reference slugs (oldest player -> smallest id).
    """
    index: dict[str, list[int]] = {}
    for player in nba_players.get_players():
        index.setdefault(join_key(player["full_name"]), []).append(player["id"])
    for ids in index.values():
        ids.sort()
    return index


def season_id_from_end_year(end_year: int) -> str:
    """1997 -> "1996-97"; 2000 -> "1999-00"."""
    return f"{end_year - 1}-{str(end_year)[2:]}"


def fetch_season_html(end_year: int) -> str:
    url = ADVANCED_URL.format(year=end_year)
    for attempt in range(1, MAX_RETRIES + 1):
        response = requests.get(url, headers=HEADERS, timeout=30)
        if response.status_code == 200:
            # Basketball Reference omits the charset from the header; the page is
            # UTF-8, so pin it or requests guesses latin-1 and mangles accented
            # names (Kukoč -> KukoÄ), breaking the nba_api name join.
            response.encoding = "utf-8"
            return response.text
        if response.status_code == 429:
            wait = REQUEST_DELAY_SECONDS * attempt * 5
            print(
                f"  rate-limited on {end_year} (attempt {attempt}); waiting {wait:.0f}s",
                file=sys.stderr,
            )
            time.sleep(wait)
            continue
        response.raise_for_status()
    raise RuntimeError(f"Failed to fetch advanced stats for {end_year} after retries")


def _cell(row, stat: str) -> str:
    cell = row.find(["td", "th"], attrs={"data-stat": stat})
    return cell.get_text(strip=True) if cell else ""


def _to_float(value: str) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_season(html: str, end_year: int) -> list[dict]:
    """Return one record per player for the season (combined row for trades).

    Each record carries the Basketball Reference ``slug`` (from the player
    cell's ``data-append-csv`` attribute) so namesakes can be paired with the
    correct nba_api id during mapping.
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="advanced") or soup.find("table", id="advanced_stats")
    if table is None or table.tbody is None:
        raise RuntimeError(f"No advanced table found for {end_year}")

    season_id = season_id_from_end_year(end_year)
    # All team-split rows of a traded player share a slug; group on it so each
    # player is represented once, preferring the combined full-season row.
    by_slug: dict[str, list] = {}
    for tr in table.tbody.find_all("tr"):
        player_cell = tr.find(["td", "th"], attrs={"data-stat": "name_display"})
        if player_cell is None:
            player_cell = tr.find(["td", "th"], attrs={"data-stat": "player"})
        if player_cell is None:
            continue  # spacer / repeated-header row
        slug = player_cell.get("data-append-csv")
        if not slug:
            continue
        by_slug.setdefault(slug, []).append(tr)

    records: list[dict] = []
    for slug, rows in by_slug.items():
        # Per-team abbreviations the player actually suited up for (the combined
        # "TOT"/"2TM" row has no franchise identity), in BR's spelling, deduped
        # but order-preserved so the first team listed is the season-opening one.
        teams: list[str] = []
        for row in rows:
            abbr = _cell(row, "team_name_abbr")
            if abbr and not _COMBINED_TEAM.fullmatch(abbr) and abbr not in teams:
                teams.append(abbr)

        if len(rows) > 1:
            combined = [
                r for r in rows if _COMBINED_TEAM.fullmatch(_cell(r, "team_name_abbr"))
            ]
            row = combined[0] if combined else rows[0]
        else:
            row = rows[0]

        minutes = _to_float(_cell(row, "mp"))
        if minutes is None:
            continue
        name = _cell(row, "name_display") or _cell(row, "player")
        if not name:
            continue

        records.append(
            {
                "slug": slug,
                "player_name": name,
                "season_id": season_id,
                "pos": _cell(row, "pos"),
                "teams": teams,
                "mp": int(minutes),
                "ws_per_48": _to_float(_cell(row, "ws_per_48")),
                "bpm": _to_float(_cell(row, "bpm")),
                "vorp": _to_float(_cell(row, "vorp")),
                "ts_pct": _to_float(_cell(row, "ts_pct")),
            }
        )
    return records


def resolve_player_ids(records: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    """Attach nba_api player_ids; return (resolved, ambiguous, unmatched).

    For each normalised name we pair the distinct Basketball Reference slugs
    (chronological by suffix) with the nba_api ids (ascending). A 1:1 count lets
    us pair by position; any count mismatch is left ambiguous.
    """
    name_index = build_name_index()

    # Distinct slugs per join key across every season, chronologically ordered.
    slugs_by_key: dict[str, list[str]] = {}
    for record in records:
        key = join_key(record["player_name"])
        slugs = slugs_by_key.setdefault(key, [])
        if record["slug"] not in slugs:
            slugs.append(record["slug"])
    for slugs in slugs_by_key.values():
        slugs.sort()

    resolved: list[dict] = []
    ambiguous: list[dict] = []
    unmatched: list[dict] = []
    for record in records:
        key = join_key(record["player_name"])
        ids = name_index.get(key, [])
        slugs = slugs_by_key[key]
        if not ids:
            unmatched.append(record)
        elif len(ids) == len(slugs):
            player_id = ids[slugs.index(record["slug"])]
            resolved.append({"player_id": player_id, **record})
        else:
            # Slug/id counts disagree (nba_api missing a namesake, or an extra
            # entry) — we cannot safely pick an id. Flag for manual review.
            ambiguous.append(record)
    return resolved, ambiguous, unmatched


def compile_dataset(first: int, last: int, min_minutes: int) -> list[dict]:
    all_records: list[dict] = []
    for end_year in range(first, last + 1):
        print(f"Fetching {season_id_from_end_year(end_year)} ...", file=sys.stderr)
        html = fetch_season_html(end_year)
        season_records = parse_season(html, end_year)
        all_records.extend(season_records)
        print(f"  parsed {len(season_records)} players", file=sys.stderr)
        time.sleep(REQUEST_DELAY_SECONDS)

    # Resolve ids using the full slug set (every season), then apply the minutes
    # filter — so a low-minute namesake season still informs slug/id pairing.
    resolved, ambiguous, unmatched = resolve_player_ids(all_records)
    rows = [row for row in resolved if row["mp"] >= min_minutes]

    _report_join("AMBIGUOUS (slug/id count mismatch; dropped)", ambiguous)
    _report_join("UNMATCHED (no nba_api id; dropped)", unmatched)
    print(
        f"\nResolved {len(resolved)} player-seasons "
        f"({len(rows)} with >= {min_minutes} minutes).",
        file=sys.stderr,
    )
    return rows


def _report_join(title: str, entries: list[dict]) -> None:
    if not entries:
        return
    unique_names = sorted({entry["player_name"] for entry in entries})
    print(
        f"\n{title}: {len(entries)} player-seasons across {len(unique_names)} names",
        file=sys.stderr,
    )
    for name in unique_names:
        print(f"  - {name}", file=sys.stderr)


def validate_coverage(rows: list[dict]) -> None:
    present = {join_key(row["player_name"]) for row in rows}
    missing = [name for name in VALIDATION_PLAYERS if join_key(name) not in present]
    if missing:
        raise SystemExit(
            "Coverage validation failed — missing well-known players: "
            + ", ".join(missing)
        )
    print(
        f"\nCoverage OK: all {len(VALIDATION_PLAYERS)} validation players present.",
        file=sys.stderr,
    )


def write_csv(rows: list[dict], path: Path) -> None:
    # Stable ordering: name then season, so diffs across refreshes are readable.
    rows = sorted(rows, key=lambda r: (r["player_name"].lower(), r["season_id"]))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "player_id": row["player_id"],
                    "player_name": row["player_name"],
                    "season_id": row["season_id"],
                    "pos": row["pos"],
                    "teams": ";".join(row["teams"]),
                    "mp": row["mp"],
                    "ws_per_48": _fmt(row["ws_per_48"]),
                    "bpm": _fmt(row["bpm"]),
                    "vorp": _fmt(row["vorp"]),
                    "ts_pct": _fmt(row["ts_pct"]),
                }
            )


def _fmt(value: float | None) -> str:
    return "" if value is None else f"{value:g}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first", type=int, default=FIRST_SEASON_END_YEAR)
    parser.add_argument("--last", type=int, default=DEFAULT_LAST_SEASON_END_YEAR)
    parser.add_argument("--min-minutes", type=int, default=DEFAULT_MIN_MINUTES)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    rows = compile_dataset(args.first, args.last, args.min_minutes)
    validate_coverage(rows)
    write_csv(rows, args.output)
    print(f"\nWrote {len(rows)} player-seasons to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
