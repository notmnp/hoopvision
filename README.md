# Hoopvision

Hoopvision is a FastAPI + React app for exploring NBA player data and running
1v1 ISO simulations.

The frontend is built with Vite, React, Tailwind, and shadcn/ui-style
components. The backend uses `nba_api` to source NBA player profiles, career
stats, combine measurements, and live scoreboard data.

## Features

- Search NBA players by name.
- View player profile data, including height, weight, position, team, career
  years, headline stats, and wingspan.
- Run 1v1 ISO simulations to 21.
- Generate possession-by-possession play-by-play.
- Adjust player tendencies across eras.
- Fall back gracefully when `stats.nba.com` is slow or unavailable.

## Data Sources

The backend uses:

- `nba_api.stats.static.players.get_players()` for local player search and ID
  resolution.
- `CommonPlayerInfo` for profile data.
- `PlayerCareerStats` for career box-score inputs.
- `DraftCombineStats`, local CSV data, and curated overrides for wingspan.
- `nba_api.live.nba.endpoints.scoreboard` for live scoreboard data.

NBA Stats requests go through `backend/app/nba_stats_client.py`, which provides:

- current `nba_api` Stats headers
- timeout configuration
- retry with backoff
- light request throttling
- in-memory response caching

`stats.nba.com` is not a formally stable public API. Keep `nba_api` current when
requests start timing out or returning empty data.

## Simulator Model

The ISO simulator is a heuristic possession model, not a production-grade
prediction model.

For each player, the backend pulls career regular-season totals and derives:

- points per game
- field goal attempts per game
- three-point attempt rate
- free throw attempt rate
- assists per game
- turnovers per game
- rebounds per game
- era pace multiplier
- era scoring environment multiplier

An embedded `MultiOutputRegressor(GradientBoostingRegressor)` predicts:

- rim, mid-range, and three-point frequency
- scoring efficiency by shot type
- foul drawing rate
- turnover rate

The model is trained from a small set of hand-authored archetype rows in
`backend/app/tendency_profile.py`, so treat results as directional and
experimental.

## Defense

Defense is currently included, but lightly.

The simulation adjusts shot make probability using physical matchup edges:

- height difference
- wingspan difference
- weight difference

It also increases turnover rate when the defender has a wingspan advantage.

The play-by-play does not yet include explicit defensive events such as blocks,
steals, contests, forced misses, or named defensive stops. Defensive impact is
reflected in the possession outcome probabilities, but not fully explained in
the event text.

## Backend Setup

From the project root:

```sh
python -m pip install -r requirements.txt
python -m uvicorn backend.app.api:app --host 127.0.0.1 --port 8000
```

The backend runs at:

```text
http://127.0.0.1:8000
```

Useful endpoints:

```text
GET  /api/player/{name}
GET  /api/scoreboard
POST /api/simulate
```

All routes are mounted under the `/api` prefix. In local development the Vite
dev server proxies `/api/*` to the backend, so the frontend needs no
`VITE_API_BASE_URL` (it defaults to `/api`).

Example:

```sh
curl "http://127.0.0.1:8000/api/player/Kyrie%20Irving"
```

## Frontend Setup

In another shell:

```sh
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

The app runs at:

```text
http://127.0.0.1:5173
```

Open the simulator at:

```text
http://127.0.0.1:5173/simulate
```

## Tests

Run backend tests:

```sh
python -m pytest backend/tests -q
```

Build the frontend:

```sh
cd frontend
npm run build
```

## Configuration

NBA Stats request behavior can be tuned with environment variables:

```text
NBA_STATS_TIMEOUT_SECONDS
NBA_STATS_RETRIES
NBA_STATS_RETRY_BACKOFF_SECONDS
NBA_STATS_MIN_REQUEST_INTERVAL_SECONDS
NBA_STATS_CACHE_TTL_SECONDS
```

Defaults are defined in `backend/app/nba_stats_client.py`.

## Environment Variables

Hoopvision deploys as a single Vercel project that serves both the Vite
frontend and the FastAPI backend, with all API calls routed under the relative
`/api` prefix. Because of that single-project, same-origin design, the only
required production variables are the Vercel KV credentials.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `KV_REST_API_URL` | Yes (production) | — | Upstash Redis REST URL. Powers bracket session persistence AND the NBA Stats response cache (survives cold starts). Auto-injected by Vercel when a KV store is connected. |
| `KV_REST_API_TOKEN` | Yes (production) | — | Upstash Redis REST token. Auto-injected by Vercel when a KV store is connected. |
| `NBA_STATS_PROXY` | Yes (production) | — | Proxy URL(s) for `stats.nba.com` calls, e.g. `http://user:pass@p.webshare.io:80` (comma-separated to rotate). Required on cloud hosts because `stats.nba.com` blocks datacenter IPs; without it player/season/shot-chart/simulation endpoints time out. Not needed locally (a residential IP isn't blocked). `cdn.nba.com` calls — headshots, scoreboard — are never proxied. |
| `BULK_SIM_MAX_N` | No | `1000` | Upper bound on `POST /api/simulate/bulk` count. Lower to `200` if bulk simulations time out on the Hobby plan. |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated allowed origins. The default covers local development; not needed in production since requests are same-origin. |

`VITE_API_BASE_URL` is **not** required: the frontend defaults to the relative
`/api` base, which is same-origin in production and proxied to
`http://localhost:8000` by the Vite dev server locally.

If `KV_REST_API_URL` / `KV_REST_API_TOKEN` are unset, the server still starts;
only the bracket endpoints return a clear `500` until KV is connected.

### Provisioning Vercel KV (one-time)

1. Open the Vercel project → **Storage** → **Connect Store** → **Create KV Store**.
2. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`; confirm they
   appear under **Settings → Environment Variables**.

## Known Limitations

- `stats.nba.com` may throttle, hang, or block requests depending on headers,
  IP reputation, and request rate.
- The cache is in-memory only; it resets when the backend process restarts.
- Wingspan coverage is incomplete and may use curated or position-average
  fallbacks.
- Defensive modeling is still shallow.
- The simulation model is heuristic and trained from a small embedded dataset.
