import json
import mimetypes
import os
import asyncio
import time
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any, List, Dict, Optional

import httpx
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from upstox_client.rest import ApiException

from backend.core.config import ACCESS_TOKEN as CONFIG_ACCESS_TOKEN, SANDBOX_ACCESS_TOKEN as CONFIG_SANDBOX_ACCESS_TOKEN
from backend.db.duckdb_client import (
    get_all_instruments,
    read_candles,
    close_connection,
    get_latest_option_chain,
    read_replay_by_date
)
from backend.db.redis_cache import (
    get_cached_ohlcv,
    get_cached_replay,
    cache_replay,
    close_redis
)
from backend.engine.upstox_manager import UpstoxManager
from dotenv import load_dotenv

load_dotenv()

# Logger setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TradingTerminalAPI")

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "4000"))
UPSTOX_BASE_V2 = "https://api.upstox.com/v2"
SERVER_ENV_TOKEN = "SERVER_ENV_TOKEN"
CACHE_ONLY_MODE = os.getenv("CACHE_ONLY_MODE", "false").lower() == "true"

app = FastAPI(title="Refactored Trading Terminal Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Upstox Manager
upstox_manager: Optional[UpstoxManager] = None

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Any):
        if isinstance(message, (dict, list)):
            message = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

ws_manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    global upstox_manager
    loop = asyncio.get_running_loop()
    upstox_manager = UpstoxManager(loop)

    # Start background loops
    asyncio.create_task(upstox_manager.process_messages_loop())
    asyncio.create_task(upstox_manager.aggregation_loop())

    # Broadcast loop to clients
    asyncio.create_task(broadcast_ticks_loop())

    # Auto-connect if token is in env
    token = resolve_token()
    if token and not is_mock_token(token):
        await upstox_manager.connect(token)

async def broadcast_ticks_loop():
    """Broadcast current market snapshot to all connected UI clients every 500ms."""
    while True:
        try:
            if upstox_manager and ws_manager.active_connections:
                snapshot = upstox_manager.get_snapshot()
                await ws_manager.broadcast({"type": "TICKS", "data": snapshot})
        except Exception as e:
            logger.error(f"Broadcast error: {e}")
        await asyncio.sleep(0.5)

@app.on_event("shutdown")
async def shutdown_event():
    if upstox_manager:
        upstox_manager.stop()
    await close_redis()
    await close_connection()

# --- Helper Functions ---

def strip_bearer(token: str | None) -> str:
    if not token: return ""
    value = token.strip()
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return value

def resolve_token(token: str | None = None) -> str:
    if token and token != SERVER_ENV_TOKEN:
        return strip_bearer(token)
    env_token = (
        CONFIG_ACCESS_TOKEN
        or os.getenv("UPSTOX_ACCESS_TOKEN")
        or os.getenv("ACCESS_TOKEN")
        or CONFIG_SANDBOX_ACCESS_TOKEN
        or os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN")
        or os.getenv("SANDBOX_ACCESS_TOKEN")
        or ""
    )
    return strip_bearer(env_token)

def is_mock_token(token: str | None) -> bool:
    if not token: return False
    lowered = token.lower()
    return any(marker in lowered for marker in ("mock", "sandbox", "test")) or token == "12345"

def success(data: Any, status_code: int = 200):
    return JSONResponse(status_code=status_code, content={"status": "success", "data": data})

def failure(message: str, status_code: int = 400):
    return JSONResponse(status_code=status_code, content={"status": "error", "message": message})

# --- API Routes ---

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "backend": "python-fastapi-async",
        "ws_clients": len(ws_manager.active_connections),
        "upstox_status": upstox_manager.ws_status if upstox_manager else "offline"
    }

@app.get("/api/upstox-config")
async def upstox_config():
    token = resolve_token()
    return {
        "hasToken": bool(token),
        "mode": "server-env" if token else "client-token",
    }

@app.post("/api/upstox/connect-ws")
async def connect_ws_endpoint(request: Request):
    body = await request.json()
    token = body.get("token")
    resolved = resolve_token(token)
    if not resolved:
        return failure("No access token provided")

    await upstox_manager.connect(resolved)
    return success({"wsStatus": upstox_manager.ws_status})

@app.post("/api/upstox/subscribe-ws")
async def subscribe_ws_endpoint(request: Request):
    body = await request.json()
    keys = body.get("keys")
    if not isinstance(keys, list) or not keys:
        return failure("keys array is required")

    if not upstox_manager or not upstox_manager.streamer:
        return failure("Upstox streamer not initialized", 404)

    try:
        upstox_manager.streamer.subscribe(keys, "full")
        return success({"message": "Subscription request delivered"})
    except Exception as e:
        return failure(str(e), 500)

@app.get("/api/upstox-feed")
async def upstox_feed():
    """Fallback polling endpoint for backward compatibility."""
    if not upstox_manager:
        return failure("Upstox manager not initialized")
    return success(upstox_manager.get_snapshot())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

@app.api_route("/api/upstox/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def upstox_proxy(path: str, request: Request):
    token = resolve_token(request.headers.get("authorization"))
    if not token:
        return failure("Unauthorized: Missing Access Token", 401)

    url = f"{UPSTOX_BASE_V2}/{path.strip('/')}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    method = request.method
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json"
    }

    body = await request.body() if method in ["POST", "PUT", "PATCH"] else None

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(method, url, headers=headers, content=body)
            if resp.status_code == 429:
                logger.warning("Upstox API Rate Limit (429) hit")
                return JSONResponse(status_code=429, content=resp.json())

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=dict(resp.headers)
            )
        except Exception as e:
            logger.error(f"Proxy error for {path}: {e}")
            return failure(f"Proxy error: {str(e)}", 502)

@app.get("/api/market-data/ohlcv/{instrument_key}")
async def get_market_ohlcv(instrument_key: str, limit: int = 200):
    try:
        cached = await get_cached_ohlcv(instrument_key, limit)
        if cached:
            return success({"candles": cached})

        candles = await read_candles(instrument_key, limit)
        return success({"candles": candles})
    except Exception as e:
        logger.error(f"Error fetching OHLCV for {instrument_key}: {e}")
        return failure(str(e), 500)

@app.get("/api/market-data/replay/{date}")
async def get_replay_data(date: str, instrument_key: str = "NSE_INDEX|Nifty 50"):
    try:
        cached = await get_cached_replay(date, instrument_key)
        if cached:
            return success({"candles": cached})

        data = await read_replay_by_date(date)
        candles = data.get(instrument_key, [])
        await cache_replay(date, instrument_key, candles)
        return success({"candles": candles})
    except Exception as e:
        return failure(str(e), 404)

@app.get("/api/market-data/instruments")
async def list_instruments():
    try:
        instruments = await get_all_instruments()
        return success({"instruments": instruments})
    except Exception as e:
        return failure(str(e), 500)

@app.get("/api/market-data/option-chain")
async def get_option_chain_data():
    try:
        data = await get_latest_option_chain()
        return success({"data": data})
    except Exception as e:
        return failure(str(e), 500)

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    dist_dir = Path("frontend/dist")
    if os.getenv("NODE_ENV") != "production":
        vite_url = "http://localhost:5173"
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(f"{vite_url}/{full_path}")
                if resp.status_code == 404:
                    resp = await client.get(f"{vite_url}/index.html")
                return Response(content=resp.content, status_code=resp.status_code, headers=dict(resp.headers))
            except Exception:
                pass

    requested = Path(full_path or "index.html")
    file_path = dist_dir / requested
    if not file_path.exists() or file_path.is_dir():
        file_path = dist_dir / "index.html"

    if not file_path.exists():
        return Response("Frontend not built. Run npm run build in frontend directory.", status_code=404)

    content_type, _ = mimetypes.guess_type(str(file_path))
    return Response(content=file_path.read_bytes(), media_type=content_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
