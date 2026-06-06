import type { SectionDefinition } from "@/types/howItWorks"

/**
 * HowItWorksContent: the single source of truth for all text, equations,
 * pseudocode, and data tables rendered on the How It Works page. Consumed by
 * HowItWorksView via the exported `sections` array. The SectionDefinition
 * type contract lives in src/types/howItWorks.ts.
 */
export const sections: SectionDefinition[] = [
  {
    id: "simulation-model",
    title: "The Simulation Model",
    plainEnglish:
      "Every matchup runs possession by possession until one player hits 21. On each possession the offensive player's tendencies decide the shot they go for, whether that's a mid-range pull-up, a three, or a drive to the rim; the defender's attributes then contest it. From there the outcome is probabilistic: the shot drops, gets blocked, draws a foul, or the ball gets turned over. Both sides are live on every trip down the floor; nobody is just standing around.",
    technical: {
      pseudocode: `for each possession:
  shot_type = sample(player_a.tendency_distribution)   # e.g. {rim: 0.42, mid: 0.21, three: 0.37}
  base_make_prob = player_a.fg_pct_by_zone[shot_type]
  contest_factor = f(player_b.block_rate, player_b.height_diff, player_b.wingspan)
  foul_prob = player_a.foul_draw_rate * (1 - contest_factor)
  to_prob = player_a.turnover_rate * player_b.steal_rate_modifier
  adjusted_make_prob = base_make_prob * contest_factor
  outcome = sample({make: adjusted_make_prob, foul: foul_prob, turnover: to_prob,
                    miss: 1 - adjusted_make_prob - foul_prob - to_prob})
  resolve_score(outcome, shot_type)`,
      equations: [
        String.raw`\text{points} = \begin{cases} 3 & \text{if } \mathit{shot\_type} = \text{"three"} \;\text{and}\; \mathit{outcome} = \text{"make"} \\[4pt] 2 & \text{if } \mathit{shot\_type} \in \{\text{"rim"}, \text{"mid"}\} \;\text{and}\; \mathit{outcome} = \text{"make"} \\[4pt] 0 & \text{otherwise} \end{cases}`,
      ],
      prose:
        "A foul retries the possession; a turnover transfers possession to the other player. The contest factor is bounded to (0, 1]; defense can only reduce make probability, never raise it above the offensive player's base rate.",
    },
  },
  {
    id: "tendency-profiles",
    title: "Tendency Profiles & the ML Model",
    plainEnglish:
      "Every player has a tendency profile: a statistical fingerprint of how they create offense. It captures their shot selection (how often they attack the rim versus pulling up for a mid-range versus launching threes), how efficient they are from each spot, how often they draw fouls, and how often they cough it up. What makes this richer than raw box-score stats is matchup conditioning; we adjust a player's tendencies based on who is guarding them, using real matchup data from games where that offensive player faced that specific defender or comparable ones.",
    technical: {
      tables: [
        {
          headers: ["Feature", "Description"],
          rows: [
            ["fg3a_rate", "Three-point attempt rate (3PA / FGA)"],
            ["rim_rate", "Rim attempt rate (attempts within 5 ft / FGA)"],
            ["mid_rate", "Mid-range attempt rate"],
            ["efg_pct", "Effective field goal percentage"],
            ["ftr", "Free throw rate (FTA / FGA)"],
            ["tov_pct", "Turnover percentage"],
            ["pace_multiplier", "Era-adjusted pace factor (see Era Normalization)"],
            ["scoring_env_multiplier", "Era-adjusted scoring environment factor"],
            ["def_rating_opponent", "Defensive rating of the matched opponent"],
            ["blk_pct_opponent", "Block percentage of the matched opponent"],
            ["height_diff", "Height differential (inches), offensive minus defensive"],
            ["wingspan_diff", "Wingspan differential (inches)"],
          ],
        },
      ],
      prose:
        "Model type: a gradient-boosted classifier (scikit-learn GradientBoostingClassifier) trained to predict shot-type distribution given player attributes and matchup context. Matchup conditioning: when observed matchup data exists for a player pair, the model trains on the actual play-by-play matchup logs; when it does not, it falls back to the player's season aggregate conditioned on the opponent's defensive profile. Calibration: we validate against a held-out season using log-loss on the shot-type distribution and Brier score on outcome probabilities, and a ModelCalibrationReport is logged at API Server startup.",
    },
  },
  {
    id: "era-normalization",
    title: "Era Normalization",
    plainEnglish:
      "The NBA of 1965 looked nothing like the NBA does now. The pace was slower, the three-pointer didn't exist until 1979, and scoring environments were worlds apart. Drop Wilt Chamberlain's raw numbers into a modern sim untouched and they mislead you; he put them up in a faster, higher-scoring league playing by different rules. Era normalization fixes that by anchoring every player's stats to the modern spacing era (the 2020-2026 baseline) before they hit the simulation. Players from slower eras get a downward pace adjustment; players from lower-scoring environments get a scoring bump. The point is a common scale, so 1965 Wilt and 2016 LeBron can be judged on the same footing.",
    technical: {
      tables: [
        {
          headers: ["Era", "Years", "Avg Pace", "Avg ORtg"],
          rows: [
            ["Early NBA", "1947-1954", "91.2", "79.4"],
            ["Russell Era", "1955-1969", "118.3", "107.1"],
            ["ABA Merger Era", "1970-1979", "107.6", "103.8"],
            ["Showtime Era", "1980-1989", "100.3", "108.6"],
            ["Physical Era", "1990-1999", "91.3", "101.9"],
            ["Early Modern", "2000-2010", "90.1", "104.5"],
            ["Analytics Era", "2011-2019", "96.8", "108.2"],
            ["Modern Spacing", "2020-2026", "100.2", "112.4"],
          ],
        },
      ],
      equations: [
        String.raw`\text{pace\_multiplier} = \frac{\text{pace\_modern\_baseline}}{\text{pace\_player\_era}}`,
        String.raw`\text{scoring\_env\_multiplier} = \frac{\text{ortg\_modern\_baseline}}{\text{ortg\_player\_era}}`,
        String.raw`s_{\text{adj}} = s_{\text{raw}} \times \text{pace\_multiplier} \times \text{scoring\_env\_multiplier}`,
      ],
      prose:
        "The eight era anchors above are what the EraAdjustmentService works from, and the adjusted-stat formula is applied to each per-game counting stat s. The modern baseline is the 2020-2026 average: pace = 100.2, ORtg = 112.4; for players already in the modern era both multipliers come out to 1.0, so their stats pass through unchanged.",
    },
  },
  {
    id: "physical-matchup-factors",
    title: "Physical Matchup Factors",
    plainEnglish:
      "Basketball is partly a game of size and length; a 7-foot center contesting a guard's floater matters. So we fold each player's height, weight, and wingspan into the simulation as secondary modifiers. They nudge the odds of specific outcomes, mostly rim finishes and blocks, but they don't override a player's tendencies. A shorter player with elite finishing at the rim still beats a tall one who rarely blocks anything, because tendencies drive the main outcome and the physical edge just adjusts around the margins.",
    technical: {
      equations: [
        String.raw`\Delta P_{\text{block}} = \alpha \cdot \tanh\!\left(\frac{\Delta h}{12}\right), \quad \alpha = 0.08, \quad \Delta P_{\text{block}} \in [-0.08, +0.08]`,
        String.raw`\text{contest\_factor} = 1 - \beta \cdot \max\!\left(0,\ \frac{\Delta w}{6}\right), \quad \beta_{\text{rim, mid}} = 0.04, \quad \beta_{\text{three}} = 0.015`,
        String.raw`\Delta P_{\text{foul}} = \gamma \cdot \frac{\Delta w_{\text{kg}}}{20}, \quad \gamma = 0.015`,
      ],
      prose:
        "The height-differential effect on rim-contest probability uses Δh = defender height minus attacker height (inches), bounded to ±0.08 so a single physical factor can't swing outcome probability by more than 8 percentage points. The wingspan contest-radius effect uses Δw = defender wingspan minus attacker wingspan (inches) and applies multiplicatively to base_make_prob for rim and mid-range shots; three-point attempts use a reduced β = 0.015, since length matters a lot less out on the perimeter. The weight-differential effect on foul probability uses Δw_kg = attacker weight minus defender weight (kg); a heavier offensive player draws fouls at a slightly higher rate against a lighter defender. All of these are secondary: they're applied after the base tendency probabilities are set, and their combined effect is capped so physical factors alone can't decide a possession.",
    },
  },
  {
    id: "confidence-tiers",
    title: "Confidence Tiers",
    plainEnglish:
      "Not every simulation is equally reliable. Pit two players who guarded each other dozens of times in real games and the model has a deep well of matchup data to pull from; it knows how Player A's shot selection shifted against Player B's defensive archetype, so that sim earns a HIGH tier. Ask for something more exotic, like a 1960s player against a modern one where no comparable matchup data exists, and the model is extrapolating more than interpolating, so that sim gets a LOW badge. A LOW tier isn't us saying the result is wrong; it's us being upfront about how far the model is reaching past what it has actually seen.",
    technical: {
      tables: [
        {
          headers: ["Tier", "Condition"],
          rows: [
            [
              "HIGH",
              "Observed matchup logs exist for this player pair or a statistically close defensive archetype match; season game log depth ≥ 40 games; all physical attributes resolved without fallback",
            ],
            [
              "MEDIUM",
              "No direct matchup logs but opponent defensive profile is well-represented in training data; season game log depth ≥ 20 games; at most one physical attribute resolved via position-average fallback",
            ],
            [
              "LOW",
              "No matchup logs and opponent profile is sparse in training data; or season game log depth < 20 games; or two or more physical attributes resolved via position-average fallback",
            ],
          ],
        },
      ],
      prose:
        "The tier is computed at profile-build time by the TendencyProfileBuilder and attached to the PlayerProfile response as a confidence_tier field, alongside a confidence_explanation string spelling out the specific factors that drove the assignment. A LOW tier doesn't block the simulation; it just shows up as an informational badge, and it's worth weighing when you read the result.",
    },
  },
  {
    id: "data-sources",
    title: "Data Sources",
    plainEnglish:
      "We pull from a few different sources to build each player profile. The NBA Stats API is the main one, with season-by-season numbers going back decades. Physical measurements like height, weight, and wingspan come from the NBA Draft Combine. Where something is missing we fall back to documented estimates, so the simulation never quietly runs on a null value.",
    technical: {
      tables: [
        {
          headers: ["Source", "Data provided"],
          rows: [
            [
              "NBA Stats API (nba_api)",
              "CommonPlayerInfo (height, weight, position, draft year); PlayerGameLog (per-game box scores for season game log depth); SeasonTotals (per-game averages used as base tendency inputs); ShotChartDetail (shot zone distribution for tendency calibration)",
            ],
            [
              "NBA Live API",
              "Live scoreboard data; powers the live game feed and isn't used in the simulation",
            ],
          ],
        },
      ],
      prose:
        "When the Combine has no wingspan on file (mostly players drafted before 2000), it falls back to a bundled roster dataset, then a curated list of legends, then a position-average constant as a last resort. Tendency model artifact: tendency_model_v2_matchup_conditioned.joblib, trained offline on NBA play-by-play matchup data and retrained once a year at season's end; the artifact version and ModelCalibrationReport are logged at API Server startup. Play-by-play matchup data gets thin before the 1996-97 season, so players from earlier eras tend to land in the MEDIUM or LOW tiers.",
    },
  },
  {
    id: "draft-82-0",
    title: "The 82-0 Draft",
    plainEnglish:
      "The 82-0 Draft is a different game from the matchup simulator. You spin a random era + franchise, draw a pool of that team's best players from that decade, and draft a starting five, one player per position, PG through C. Once all five slots are filled, the lineup is graded into a full 82-game record, so a roster comes out looking like a title contender or a lottery team. The scoring leans on advanced metrics that are already built for cross-era comparison, so it rewards two things: drafting genuinely great players, and drafting players who complement each other instead of five who all do the same one thing well. A balanced five that covers every dimension beats a lopsided one stacked on a single strength.",
    technical: {
      pseudocode: `# Draw phase (stateless; client holds all state, server just answers reads)
era       = random_unseen(GET /draft/eras)
franchise = random_unseen(GET /draft/franchises?era=era)
pool      = GET /draft/pool?era=era&franchise_id=franchise&exclude=seen_ids
if pool.auto_respin:          # < 3 viable players for the combo
    redraw()                  # spin again, no slot burned
# pool = top 14 players by WS/48, peak franchise-season within the era window

# Placement phase (one player per slot, must be position-eligible)
for slot in [PG, SG, SF, PF, C]:
    lineup[slot] = user_pick(pool, eligible_for=slot)

# Score phase
score = POST /draft/score { players: lineup }   # -> { wins, losses, breakdown }`,
      tables: [
        {
          headers: ["Slot", "WS/48", "BPM", "VORP", "TS%"],
          rows: [
            ["PG", "0.15", "0.35", "0.35", "0.15"],
            ["SG", "0.15", "0.25", "0.35", "0.25"],
            ["SF", "0.20", "0.25", "0.35", "0.20"],
            ["PF", "0.30", "0.25", "0.35", "0.10"],
            ["C", "0.35", "0.20", "0.35", "0.10"],
          ],
        },
      ],
      equations: [
        String.raw`z_{\text{ws}} = \frac{\text{WS/48} - 0.10}{0.15},\quad z_{\text{bpm}} = \frac{\text{BPM}}{8},\quad z_{\text{vorp}} = \frac{\text{VORP} - 2.0}{4},\quad z_{\text{ts}} = \frac{\text{TS\%} - 0.56}{0.08},\quad z \in [-2,\, 2]`,
        String.raw`r = \mathrm{clamp}\!\left(\frac{\text{MP}}{2000},\, 0.5,\, 1\right),\qquad \text{contribution}_i = w_{\text{ws}}\,r\,z_{\text{ws}} + w_{\text{bpm}}\,r\,z_{\text{bpm}} + w_{\text{vorp}}\,z_{\text{vorp}} + w_{\text{ts}}\,r\,z_{\text{ts}}`,
        String.raw`\text{coverage} = \frac{1}{4}\sum_{m}\mathrm{clamp}\!\left(\max_{i}\,z_{m,i},\, 0,\, 1\right),\qquad \text{team\_score} = \sum_{i}\text{contribution}_i + 0.45\,\text{coverage}`,
        String.raw`\text{wins} = \mathrm{round}\!\left(\frac{82}{1 + e^{-0.8\,\text{team\_score}}}\right)`,
      ],
      prose:
        "The draw is stateless: the client holds the whole session and only makes three read-only calls (eras, franchises, pool) plus one POST to score, so a refresh starts over. A pool is the franchise's fourteen best players (by WS/48) whose peak season lands inside the era's decade window; if fewer than three players qualify, the API returns an auto_respin signal and the spin is redrawn for free. Scoring (DraftScoringEngine) uses four advanced metrics — WS/48, BPM, VORP, TS% — that are already era-normalized, so unlike the matchup simulator no separate era adjustment is applied. Each metric is centered on a league-average starter: the league-average value maps to 0, an elite peak season to about +1, and a below-average season goes negative — so a weak starter actively drags the team down instead of being a free empty slot, with each metric capped at ±2 so one historic outlier can't run away with the score. Rate stats (WS/48, BPM, TS%) are shrunk toward average for small-minutes seasons via the reliability factor r, so a 500-minute specialist's gaudy rate isn't trusted as full-time starter production; VORP is already minutes-aware and carries the volume signal, so it isn't shrunk and anchors every position at 0.35 weight. Per-player contribution uses position-specific weights (table above, each row sums to 1.0): guards lean on BPM, bigs on WS/48, and TS% is a smaller efficiency garnish. The coverage term adds a small synergy bonus for a five that is genuinely above average in every dimension, rewarding complementary rosters over players piled into one strength. The team score maps to wins through a logistic centered at zero, so a league-average five lands near 41 wins (.500) while a stack of all-time peak seasons clears the rounding threshold to a perfect 82-0 — the game's stated goal. The per-player contribution shown in the result breakdown is exactly the centered value that fed the aggregate, so the score stays explainable.",
    },
  },
]
