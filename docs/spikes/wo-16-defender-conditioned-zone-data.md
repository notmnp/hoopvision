# WO-16 Spike: nba_api path for defender-height-conditioned zone shot data

**Status:** Resolved — Path B (no viable nba_api path; limitation documented and mitigated)
**Date:** 2026-05-23

## Question

`MatchupDataService._fetch_zone_data()` includes `height_bucket` in the
`ShotChartDetail` cache key but makes no defender-height filter call, because
`ShotChartDetail` has no such parameter. As a result, all four height buckets
returned identical, undifferentiated shot charts (and were fetched/cached four
times). This spike asked whether any nba_api endpoint can supply zone-level
shot data actually conditioned on defender size.

## Endpoints evaluated

Parameters and result sets were inspected directly against the installed
`nba_api` package (`nba_api.stats.endpoints`, 137 endpoints available).

| Endpoint | Zone/location granularity | Defender info exposed | Verdict |
|---|---|---|---|
| `ShotChartDetail` | Yes — `SHOT_ZONE_BASIC/AREA/RANGE` per shot | None. 35 params, no defender filter. `position_nullable`/`player_position_nullable` filter the **shooter**, not the defender. | Cannot condition on defender |
| `LeagueSeasonMatchups` | No — season totals per offense/defense pair, no shot-location fields | Defender **identity** (`DEF_PLAYER_ID`) | Has defender, but no zone breakdown |
| `PlayerDashPtShots` | Partial — `general_shooting` has shot-type buckets | Defender **distance** only (`closest_defender_shooting`, bins like "0-2 ft Very Tight"). No defender identity or size; distance ≠ size; defender breakdown is a **separate result set** from the zone breakdown, never crossed in one row | Distance, not size; not crossed with zone |
| `LeagueDashPlayerShotLocations` | Yes — `distance_range` ("By Zone", "5ft Range", …) | None toward the defender. `height_nullable`/`weight_nullable` filter the **shooting player**, not the defender | Cannot condition on defender |
| `SynergyPlayTypes` | No — play-type efficiency only | None | Not applicable |
| `PlayByPlayV2` | No — event rows have no shot coordinates/zone | No closest-defender field. Only `PLAYER1/2/3_ID`, where `PLAYER3` is the blocker **on block events only** | No per-shot defender identity |

### Why no join recovers the missing dimension

The only endpoint exposing a defender identity per offensive player is
`LeagueSeasonMatchups`, but it is **aggregate** (season totals per off/def pair)
with no shot-location rows — there is no shared shot/event key to join it to
`ShotChartDetail`. `ShotChartDetail` rows carry `GAME_ID` + `GAME_EVENT_ID` and
could be joined to `PlayByPlayV2` by event, but `PlayByPlayV2` does not record
the closest defender on a shot (only the blocker on blocked shots), so the join
yields a defender for blocked shots only — a biased, unusable subset.

The shot-level "closest defender" tracking that would answer this question
(Second Spectrum) is **not exposed** through the public stats.nba.com / nba_api
surface. `PlayerDashPtShots` exposes only coarse defender-**distance** bins, not
identity or size, and never crossed with shot zone.

## Decision: Path B

No viable nba_api path exists. The limitation is documented and mitigated rather
than implemented around:

1. `MatchupConditionedStats` gained a `data_warnings: list[str]` field, populated
   with `ZONE_DATA_UNCONDITIONED_WARNING` whenever `zone_data` is returned.
2. The `ShotChartDetail` cache key dropped `height_bucket`
   (`shotchartdetail:{season}:{player_id}`), so a player-season is fetched and
   cached once instead of four times.
3. `TendencyProfileBuilder` propagates `MatchupConditionedStats.data_warnings`
   into the `TendencyProfile.data_warnings` it already surfaces, so the
   limitation reaches `MatchSummary`.
4. The NBA Data blueprint's `MatchupDataService` component spec documents that
   `zone_data` is undifferentiated by defender height.

## Blueprint amendment (apply manually — blueprint is read-only via MCP tooling)

The NBA Data blueprint's `MatchupDataService` component spec currently claims:

> Query nba_api ShotChartDetail with defender height filtering to provide
> zone-level shot selection and efficiency conditioned on defender size

This is inaccurate and should be replaced with:

> Query nba_api ShotChartDetail for the offensive player's zone-level shot
> selection and efficiency. **Note:** ShotChartDetail has no defender filter,
> and no nba_api endpoint supplies zone-level shot data conditioned on defender
> size (see docs/spikes/wo-16-defender-conditioned-zone-data.md). `zone_data` is
> therefore undifferentiated by defender height — it reflects the player's
> career-average shot distribution against all defenders. This limitation is
> surfaced to callers via the `data_warnings` field on `MatchupConditionedStats`.

The integration contract for `MatchupConditionedStats` should also add the
`data_warnings: string[]` field:

> #MatchupDataService returns `MatchupConditionedStats: { sufficient_sample:
> bool, possession_count: int, zone_data: ZoneShotData[], height_bucket: string,
> data_warnings: string[] }` to #TendencyProfileBuilder.

## If revisited (future Path A)

A defender-height-conditioned zone solution would require a data source outside
the free nba_api surface — e.g. licensed Second Spectrum / tracking shot data
with per-shot closest-defender identity, or a paid provider. That is explicitly
out of scope here (no third-party paid sources) and would warrant its own work
order with a cost-per-player-per-bucket-per-season estimate.
