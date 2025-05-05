from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from nba_api.stats.static import players
from nba_api.stats.endpoints import commonplayerinfo
from nba_api.live.nba.endpoints import scoreboard

app = FastAPI()

origins = [
    "http://localhost:5173",
    "localhost:5173"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/", tags=["root"])
async def read_root() -> dict:
    return {"message": "Welcome to your NBA API backend."}


@app.get("/player/{name}", tags=["nba"])
async def get_player_info(name: str):
    # Find player by full or partial name
    matched_players = players.find_players_by_full_name(name)
    if not matched_players:
        raise HTTPException(status_code=404, detail="Player not found")

    player = matched_players[0]  # Get first match
    player_id = player["id"]

    try:
        info = commonplayerinfo.CommonPlayerInfo(player_id=player_id)
        data = info.get_normalized_dict()
        return {"player": player["full_name"], "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching data: {str(e)}")
    
@app.get("/scoreboard", tags=["nba"])
async def get_today_scoreboard():
    try:
        games = scoreboard.ScoreBoard()
        return games.get_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch scoreboard: {str(e)}")