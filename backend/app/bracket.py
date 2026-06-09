"""Single-elimination bracket orchestration on top of the IsoLab engine.

`BracketOrchestrator` manages the full bracket lifecycle: it seeds a
single-elimination tree from a `BracketConfig`, runs each matchup as a best-of
series by calling `SimulationEngine` in-process (ADR-001), advances winners
round-by-round, and holds every `BracketState` in an in-process session store
keyed by `bracket_id` (ADR-002). The in-process store is a working copy: when
Vercel KV credentials are configured, `api.py` persists every state mutation to
KV (`bracket:{bracket_id}`, 24-hour TTL) and rehydrates the store from KV on
each request, so brackets survive serverless cold starts. Without KV the store
is the only copy and state is lost on process restart.

The data models live here (rather than `api.py`) so the orchestration logic is
testable without standing up FastAPI, mirroring how `simulation.py` and
`matchup_data.py` own their own contracts.
"""

import asyncio
import uuid
from dataclasses import dataclass
from math import log2
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from .simulation import SimulationEngine


PossessionMode = Literal["make_it_take_it", "alternating"]
BracketSize = Literal[4, 8, 16]
SeriesFormat = Literal[1, 3, 5, 7]
BracketStatus = Literal["SETUP", "IN_PROGRESS", "COMPLETE"]

# A single SimulationEngine.simulate() result: { play_by_play, summary }.
SimulationResult = dict[str, Any]

# The callable BracketOrchestrator uses to run one game. Decoupling from
# SimulationEngine directly keeps the orchestrator easy to stub in tests and
# lets WO-34 swap in a thread-pool-offloaded variant without touching callers.
GameSimulator = Callable[[int, int, str, str, PossessionMode], SimulationResult]


class BracketValidationError(ValueError):
    """Raised when a BracketConfig is structurally invalid (e.g. wrong count)."""


class BracketParticipant(BaseModel):
    player_id: int
    season_id: str
    seed: int
    # The player's display name. Optional on input (older clients omit it); the
    # API backfills it from the static player index at creation so the bracket
    # view can label participants without a separate name lookup.
    name: str | None = None


class BracketConfig(BaseModel):
    participants: list[BracketParticipant]
    bracket_size: BracketSize
    series_format: SeriesFormat
    possession_mode: PossessionMode = "make_it_take_it"


class SeriesWins(BaseModel):
    a: int = 0
    b: int = 0


class BracketMatchup(BaseModel):
    # seed/player slots are nullable because rounds beyond the first are created
    # empty and filled only as winners advance into them.
    seed_a: int | None = None
    seed_b: int | None = None
    player_a: BracketParticipant | None = None
    player_b: BracketParticipant | None = None
    series_wins: SeriesWins = Field(default_factory=SeriesWins)
    games: list[SimulationResult] = Field(default_factory=list)
    winner: BracketParticipant | None = None


class BracketRound(BaseModel):
    round_number: int
    matchups: list[BracketMatchup]


class BracketState(BaseModel):
    bracket_id: str
    bracket_size: int
    series_format: int
    status: BracketStatus
    rounds: list[BracketRound]
    champion: BracketParticipant | None = None


@dataclass
class _BracketSession:
    """In-memory record for one bracket: its state plus replay inputs.

    `possession_mode` is held here rather than on `BracketState` because it is a
    simulation input, not part of the bracket's public shape.
    """

    state: BracketState
    possession_mode: PossessionMode


# Curated all-time greats and their peak seasons, in seed order (ADR-003: index
# 0 is seed 1). Default brackets of size 4 and 8 are the top-N prefix of this
# list, so a player's seed stays consistent across every default size.
CURATED_GREATS: list[tuple[str, str]] = [
    ("Michael Jordan", "1995-96"),
    ("LeBron James", "2012-13"),
    ("Stephen Curry", "2015-16"),
    ("Kareem Abdul-Jabbar", "1971-72"),
    ("Kevin Durant", "2013-14"),
    ("Tim Duncan", "2002-03"),
    ("Giannis Antetokounmpo", "2019-20"),
    ("Magic Johnson", "1986-87"),
    ("Nikola Jokic", "2023-24"),
    ("Shaquille O'Neal", "1999-00"),
    ("Kobe Bryant", "2005-06"),
    ("Larry Bird", "1985-86"),
    ("Luka Doncic", "2023-24"),
    ("Hakeem Olajuwon", "1993-94"),
    ("Joel Embiid", "2022-23"),
    ("Wilt Chamberlain", "1966-67"),
]

SUPPORTED_BRACKET_SIZES = (4, 8, 16)

# Resolves a curated player's full name to its nba_api player_id. Injected so
# the static-player lookup stays in api.py and this module stays import-light.
PlayerIdResolver = Callable[[str], int | None]


def default_bracket_config(
    size: int,
    resolve_player_id: PlayerIdResolver,
    series_format: SeriesFormat = 7,
) -> BracketConfig:
    """Build a pre-configured BracketConfig of curated greats for `size`.

    Raises BracketValidationError for unsupported sizes (AC-GB-001.4 covers the
    happy path; an out-of-range size is a client error surfaced as 400).
    """
    if size not in SUPPORTED_BRACKET_SIZES:
        raise BracketValidationError(
            f"Unsupported bracket size {size}; expected one of "
            f"{', '.join(str(s) for s in SUPPORTED_BRACKET_SIZES)}."
        )

    participants: list[BracketParticipant] = []
    for index, (name, season_id) in enumerate(CURATED_GREATS[:size]):
        player_id = resolve_player_id(name)
        if player_id is None:
            raise BracketValidationError(
                f"Could not resolve curated player {name!r} to a player_id."
            )
        participants.append(
            BracketParticipant(
                player_id=player_id,
                season_id=season_id,
                seed=index + 1,
                name=name,
            )
        )

    return BracketConfig(
        participants=participants,
        bracket_size=size,
        series_format=series_format,
    )


def standard_seed_order(bracket_size: int) -> list[int]:
    """Return the first-round seed slot order for a single-elimination bracket.

    Built by the classic recursive mirroring so that the top seeds are spread
    across the tree and the two best seeds can only meet in the final. For a
    size of 8 this yields [1, 8, 4, 5, 2, 7, 3, 6], whose consecutive pairs are
    the first-round matchups (1v8, 4v5, 2v7, 3v6).
    """
    seeds = [1]
    while len(seeds) < bracket_size:
        slot_count = len(seeds) * 2
        mirrored: list[int] = []
        for seed in seeds:
            mirrored.append(seed)
            mirrored.append(slot_count + 1 - seed)
        seeds = mirrored
    return seeds


class BracketOrchestrator:
    def __init__(
        self,
        engine: SimulationEngine,
        game_simulator: GameSimulator | None = None,
    ):
        self._engine = engine
        # Default to an in-process SimulationEngine.simulate call (ADR-001);
        # tests inject a deterministic stub instead.
        self._simulate_game: GameSimulator = game_simulator or self._engine_simulate
        self._sessions: dict[str, _BracketSession] = {}

    def _engine_simulate(
        self,
        player_a_id: int,
        player_b_id: int,
        season_a_id: str,
        season_b_id: str,
        possession_mode: PossessionMode,
    ) -> SimulationResult:
        return self._engine.simulate(
            player_a_id,
            player_b_id,
            season_a_id,
            season_b_id,
            possession_mode=possession_mode,
        )

    def create_bracket(self, config: BracketConfig) -> BracketState:
        if len(config.participants) != config.bracket_size:
            raise BracketValidationError(
                f"Expected {config.bracket_size} participants for a "
                f"{config.bracket_size}-player bracket, got "
                f"{len(config.participants)}."
            )

        # ADR-003: seeds are positional — the first participant is seed 1, the
        # last is seed N. We normalize each participant's seed to its submission
        # index so the stored bracket is internally consistent regardless of the
        # seed values the client sent.
        participants_by_seed: dict[int, BracketParticipant] = {}
        for index, participant in enumerate(config.participants):
            seed = index + 1
            participants_by_seed[seed] = participant.model_copy(update={"seed": seed})

        order = standard_seed_order(config.bracket_size)
        first_round = BracketRound(
            round_number=1,
            matchups=[
                BracketMatchup(
                    seed_a=order[i],
                    seed_b=order[i + 1],
                    player_a=participants_by_seed[order[i]],
                    player_b=participants_by_seed[order[i + 1]],
                )
                for i in range(0, len(order), 2)
            ],
        )

        rounds = [first_round]
        total_rounds = int(log2(config.bracket_size))
        for round_number in range(2, total_rounds + 1):
            matchup_count = config.bracket_size // (2**round_number)
            rounds.append(
                BracketRound(
                    round_number=round_number,
                    matchups=[BracketMatchup() for _ in range(matchup_count)],
                )
            )

        bracket_id = uuid.uuid4().hex
        state = BracketState(
            bracket_id=bracket_id,
            bracket_size=config.bracket_size,
            series_format=config.series_format,
            status="SETUP",
            rounds=rounds,
        )
        self._sessions[bracket_id] = _BracketSession(
            state=state, possession_mode=config.possession_mode
        )
        return state

    def get_state(self, bracket_id: str) -> BracketState:
        return self._session(bracket_id).state

    async def run_round(self, bracket_id: str) -> BracketState:
        session = self._session(bracket_id)
        state = session.state
        if state.status == "COMPLETE":
            return state

        target_round = self._pending_round(state)
        if target_round is None:
            return state

        # ADR-005: matchups in a round are independent, so dispatch them
        # concurrently. Each series' synchronous game loop is offloaded to the
        # event loop's default thread pool executor via run_in_executor, so the
        # round's wall-clock time is bounded by the slowest single series rather
        # than the sum of all of them, while SimulationEngine stays synchronous.
        playable = [
            matchup for matchup in target_round.matchups if self._is_playable(matchup)
        ]
        loop = asyncio.get_running_loop()
        await asyncio.gather(
            *(
                loop.run_in_executor(
                    None,
                    self._simulate_series,
                    matchup,
                    state.series_format,
                    session.possession_mode,
                )
                for matchup in playable
            )
        )

        self._advance_round(state, target_round)
        state.status = self._compute_status(state)
        return state

    async def run_all(self, bracket_id: str) -> BracketState:
        state = self._session(bracket_id).state
        # Each call resolves exactly one round, so the tournament completes in at
        # most `len(rounds)` iterations; the cap guards against any non-advancing
        # edge case rather than spinning forever.
        for _ in range(len(state.rounds) + 1):
            if state.status == "COMPLETE":
                break
            state = await self.run_round(bracket_id)
        return state

    def _session(self, bracket_id: str) -> _BracketSession:
        session = self._sessions.get(bracket_id)
        if session is None:
            raise KeyError(bracket_id)
        return session

    @staticmethod
    def _pending_round(state: BracketState) -> BracketRound | None:
        """The lowest-numbered round that still has a playable matchup."""
        for bracket_round in state.rounds:
            if any(
                BracketOrchestrator._is_playable(matchup)
                for matchup in bracket_round.matchups
            ):
                return bracket_round
        return None

    @staticmethod
    def _is_playable(matchup: BracketMatchup) -> bool:
        return (
            matchup.winner is None
            and matchup.player_a is not None
            and matchup.player_b is not None
        )

    def _simulate_series(
        self,
        matchup: BracketMatchup,
        series_format: int,
        possession_mode: PossessionMode,
    ) -> None:
        # ADR-004: a series is decided when one player reaches the majority of
        # the best-of-N format. Games are run without a fixed seed so each game
        # is an independent draw and the series can swing between players.
        wins_needed = series_format // 2 + 1
        player_a = matchup.player_a
        player_b = matchup.player_b
        assert player_a is not None and player_b is not None

        a_wins = 0
        b_wins = 0
        games: list[SimulationResult] = []
        while a_wins < wins_needed and b_wins < wins_needed:
            result = self._simulate_game(
                player_a.player_id,
                player_b.player_id,
                player_a.season_id,
                player_b.season_id,
                possession_mode,
            )
            games.append(result)
            final_score = result["summary"]["final_score"]
            if final_score["a"] > final_score["b"]:
                a_wins += 1
            else:
                b_wins += 1

        matchup.series_wins = SeriesWins(a=a_wins, b=b_wins)
        matchup.games = games
        matchup.winner = player_a if a_wins == wins_needed else player_b

    @staticmethod
    def _advance_round(state: BracketState, completed_round: BracketRound) -> None:
        next_round_number = completed_round.round_number + 1
        if next_round_number > len(state.rounds):
            # The final round just resolved; its single winner is the champion.
            state.champion = completed_round.matchups[0].winner
            return

        next_round = state.rounds[next_round_number - 1]
        for index, matchup in enumerate(completed_round.matchups):
            winner = matchup.winner
            if winner is None:
                continue
            target = next_round.matchups[index // 2]
            if index % 2 == 0:
                target.player_a = winner
                target.seed_a = winner.seed
            else:
                target.player_b = winner
                target.seed_b = winner.seed

    @staticmethod
    def _compute_status(state: BracketState) -> BracketStatus:
        if state.champion is not None:
            return "COMPLETE"
        any_resolved = any(
            matchup.winner is not None
            for bracket_round in state.rounds
            for matchup in bracket_round.matchups
        )
        return "IN_PROGRESS" if any_resolved else "SETUP"
