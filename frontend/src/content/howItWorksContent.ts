import type { SectionDefinition } from "@/types/howItWorks"

/**
 * HowItWorksContent — the single source of truth for all text, equations,
 * pseudocode, and data tables rendered on the How It Works page. Consumed by
 * HowItWorksView via the exported `sections` array. The SectionDefinition
 * type contract lives in src/types/howItWorks.ts.
 */
export const sections: SectionDefinition[] = [
  {
    id: "simulation-model",
    title: "The Simulation Model",
    plainEnglish:
      "Each matchup is simulated possession by possession until one player reaches 21 points. On every possession, the offensive player's tendencies determine what kind of shot they attempt — a mid-range jumper, a three-pointer, or a drive to the rim — and the defensive player's attributes contest that attempt. The result is resolved probabilistically: the ball goes in, gets blocked, draws a foul, or turns over. Neither player is passive — every possession models both sides of the ball.",
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
        "A foul retries the possession; a turnover transfers possession to the other player. The contest factor is bounded to (0, 1] — defense can only reduce make probability, never raise it above the offensive player's base rate.",
    },
  },
  {
    id: "tendency-profiles",
    title: "Tendency Profiles & the ML Model",
    plainEnglish:
      "Every player in HoopVision has a tendency profile — a statistical fingerprint of how they create offense. It captures their shot selection (how often they go to the rim versus pulling up for a mid-range versus launching threes), their scoring efficiency at each location, how often they draw fouls, and how often they turn the ball over. What makes HoopVision's model richer than raw box-score stats is matchup conditioning: the model adjusts a player's tendencies based on who is guarding them, using real matchup data from NBA games where that offensive player faced that specific defensive player or comparable defenders.",
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
        "Model type: a gradient-boosted classifier (scikit-learn GradientBoostingClassifier) trained to predict shot-type distribution given player attributes and matchup context. Matchup conditioning: when observed matchup data exists for a player pair, the model uses actual play-by-play matchup logs as training samples; when it does not, it falls back to the player's season aggregate conditioned on the opponent's defensive profile. Calibration: the model is validated against a held-out season using log-loss on shot-type distribution and Brier score on outcome probabilities, and a ModelCalibrationReport is logged at API Server startup. Artifact: serialized via joblib as tendency_model_v2_matchup_conditioned.joblib, bundled in backend/data/, and loaded once at startup.",
    },
  },
  {
    id: "era-normalization",
    title: "Era Normalization",
    plainEnglish:
      "The NBA of 1965 looked nothing like the NBA of 2024. Pace was slower, three-pointers didn't exist until 1979, and scoring environments were completely different. If you take Wilt Chamberlain's raw stats and drop them into a modern simulation without adjustment, the numbers are misleading — he was playing in a faster, higher-scoring era by a different set of rules. Era normalization solves this by anchoring every player's stats to the modern spacing era (2020–2026 baseline) before they enter the simulation. Players from slower eras get a downward pace adjustment; players from lower-scoring environments get a scoring uplift. The goal is a common scale where a 1965 Wilt and a 2016 LeBron can be compared on equal footing.",
    technical: {
      tables: [
        {
          headers: ["Era", "Years", "Avg Pace", "Avg ORtg"],
          rows: [
            ["Early NBA", "1947–1954", "91.2", "79.4"],
            ["Russell Era", "1955–1969", "118.3", "107.1"],
            ["ABA Merger Era", "1970–1979", "107.6", "103.8"],
            ["Showtime Era", "1980–1989", "100.3", "108.6"],
            ["Physical Era", "1990–1999", "91.3", "101.9"],
            ["Early Modern", "2000–2010", "90.1", "104.5"],
            ["Analytics Era", "2011–2019", "96.8", "108.2"],
            ["Modern Spacing", "2020–2026", "100.2", "112.4"],
          ],
        },
      ],
      equations: [
        String.raw`\text{pace\_multiplier} = \frac{\text{pace\_modern\_baseline}}{\text{pace\_player\_era}}`,
        String.raw`\text{scoring\_env\_multiplier} = \frac{\text{ortg\_modern\_baseline}}{\text{ortg\_player\_era}}`,
        String.raw`s_{\text{adj}} = s_{\text{raw}} \times \text{pace\_multiplier} \times \text{scoring\_env\_multiplier}`,
      ],
      prose:
        "The eight era anchors above are used by the EraAdjustmentService. The adjusted-stat formula is applied per per-game counting stat s. The modern baseline is the 2020–2026 average: pace = 100.2, ORtg = 112.4. Both multipliers equal 1.0 for players in the modern era — their stats pass through unchanged.",
    },
  },
  {
    id: "physical-matchup-factors",
    title: "Physical Matchup Factors",
    plainEnglish:
      "Basketball is partly a game of size and length. A 7-foot center contesting a guard's floater matters. HoopVision accounts for this by factoring each player's height, weight, and wingspan into the simulation as secondary modifiers. They adjust the probability of specific outcomes — particularly rim finishes and blocks — but they do not override a player's statistical tendencies. A short player with elite finishing stats at the rim still outperforms a tall player who rarely blocks shots, because tendencies drive the primary outcome and physics adjusts around the margins.",
    technical: {
      equations: [
        String.raw`\Delta P_{\text{block}} = \alpha \cdot \tanh\!\left(\frac{\Delta h}{12}\right), \quad \alpha = 0.08, \quad \Delta P_{\text{block}} \in [-0.08, +0.08]`,
        String.raw`\text{contest\_factor} = 1 - \beta \cdot \max\!\left(0,\ \frac{\Delta w}{6}\right), \quad \beta_{\text{rim, mid}} = 0.04, \quad \beta_{\text{three}} = 0.015`,
        String.raw`\Delta P_{\text{foul}} = \gamma \cdot \frac{\Delta w_{\text{kg}}}{20}, \quad \gamma = 0.015`,
      ],
      prose:
        "Height differential effect on rim-contest probability uses Δh = defender height minus attacker height (inches), bounded to ±0.08 so a single physical factor cannot swing outcome probability by more than 8 percentage points. The wingspan contest-radius effect uses Δw = defender wingspan minus attacker wingspan (inches) and applies multiplicatively to base_make_prob for rim and mid-range shot types; three-point attempts use a reduced β = 0.015 reflecting the lower effect of length on perimeter shots. The weight differential effect on foul probability uses Δw_kg = attacker weight minus defender weight (kg) — a heavier offensive player draws fouls at a slightly higher rate against a lighter defender. All physical modifiers are secondary: they are applied after the base tendency probabilities are established, and their combined effect is capped so that physical factors alone cannot determine the possession outcome.",
    },
  },
  {
    id: "confidence-tiers",
    title: "Confidence Tiers",
    plainEnglish:
      "Not every simulation is equally reliable. When you pit two players who faced each other dozens of times in real NBA games, the model has rich real-world matchup data to draw from — it knows how Player A's shot selection shifted when guarded by Player B's defensive archetype. That simulation gets a HIGH confidence tier. When the matchup is more exotic — say, a 1960s player against a modern player where no comparable matchup data exists — the model is extrapolating more than it is interpolating. That simulation gets a LOW tier badge. It is not a warning that the simulation is wrong; it is transparency about how far the model is operating from its training distribution.",
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
        "The tier is computed at profile-build time by the TendencyProfileBuilder and attached to the PlayerProfile response as a confidence_tier field, alongside a confidence_explanation string describing the specific factors that drove the assignment. A LOW tier does not prevent simulation — it surfaces to the user as an informational badge and should inform how much weight they place on the result.",
    },
  },
  {
    id: "data-sources",
    title: "Data Sources",
    plainEnglish:
      "HoopVision draws from several data sources to build its player profiles. The NBA Stats API is the primary source for season-by-season performance statistics going back decades. Physical measurements — height, weight, wingspan — are critical inputs to the simulation; wingspan in particular is sourced through a four-tier fallback because it is only formally measured at the NBA Draft Combine (for players drafted since 2000). Historical legends like Jordan, Bird, and Shaq have curated wingspan entries. Every data gap has a disclosed fallback, and the simulation never silently uses a null value.",
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
              "Live scoreboard data — not used in simulation, powers the live game feed",
            ],
          ],
        },
        {
          headers: ["Wingspan fallback (priority order)", "Source"],
          rows: [
            [
              "1. NBA Draft Combine",
              "draftcombinestats endpoint — players drafted 2000+, measured wingspan in inches",
            ],
            [
              "2. Bundled CSV",
              "backend/data/nba_wingspan_performance_2025.csv — active roster seasonal snapshot (CC-BY-4.0, SCORE Sports Data Repository)",
            ],
            [
              "3. Curated dictionary",
              "~17 historical legends (Jordan: 80.25\", Bird: 83.0\", Shaq: 86.0\", etc.)",
            ],
            [
              "4. Position-average constant",
              "G: 78\", F: 83\", C: 88\" — guaranteed last resort; appends a warning to data_warnings",
            ],
          ],
        },
      ],
      prose:
        "Tendency model artifact: tendency_model_v2_matchup_conditioned.joblib — trained offline on NBA play-by-play matchup data and retrained annually at end of season; the artifact version string and ModelCalibrationReport are logged at API Server startup. Limitations: the tendency model is retrained once per season, so mid-season trades, injuries, or role changes are not reflected until the next retraining cycle. Historical play-by-play matchup data becomes sparse before the 1996–97 season, so players from earlier eras are more likely to receive MEDIUM or LOW confidence tiers.",
    },
  },
]
