import json
import mimetypes
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any
import upstox_client
from config import ACCESS_TOKEN as CONFIG_ACCESS_TOKEN, SANDBOX_ACCESS_TOKEN as CONFIG_SANDBOX_ACCESS_TOKEN
from data.duckdb_client import get_connection, read_candles, close_connection
from data.redis_cache import cache_ohlcv, get_cached_ohlcv, cache_replay, get_cached_replay, close_redis
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from upstox_client.rest import ApiException

load_dotenv()

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "4000"))
UPSTOX_BASE_V2 = "https://api.upstox.com/v2"
SERVER_ENV_TOKEN = "SERVER_ENV_TOKEN"
DEFAULT_SUBSCRIPTION_KEYS = ["NSE_INDEX|Nifty 50"]
CACHE_ONLY_MODE = os.getenv("CACHE_ONLY_MODE", "false").lower() == "true"

app = FastAPI(title="Traders Terminal Python Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        os.getenv("FRONTEND_URL", ""),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RateLimitCircuitBreaker:
    def __init__(self, failure_threshold: int = 3, reset_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.lock = threading.Lock()
        self.open_until = 0
    
    def can_execute(self) -> bool:
        with self.lock:
            if time.time() < self.open_until:
                return False
            if self.open_until and time.time() >= self.open_until:
                self.failure_count = 0
            return True
    
    def record_failure(self) -> None:
        with self.lock:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.open_until = time.time() + self.reset_timeout
    
    def record_success(self) -> None:
        with self.lock:
            self.failure_count = 0
            self.open_until = 0
    
    def get_state(self) -> dict[str, Any]:
        with self.lock:
            return {
                "failure_count": self.failure_count,
                "threshold": self.failure_threshold,
                "open_until": self.open_until,
                "is_open": time.time() < self.open_until
            }

rate_limit_breaker = RateLimitCircuitBreaker()


class UpstoxLiveState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.streamer: Any = None
        self.token: str | None = None
        self.spot_price = 0.0
        self.prev_spot_price = 0.0
        self.last_updated = 0
        self.ticks: dict[str, dict[str, float | int]] = {}
        self.ws_status = "disconnected"
        self.ws_error: str | None = None
        self.price_buffer: defaultdict = defaultdict(list)
        self.oi_buffer: defaultdict = defaultdict(list)


live_state = UpstoxLiveState()


def strip_bearer(token: str | None) -> str:
    if not token:
        return ""
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
    if not token:
        return False
    lowered = token.lower()
    return any(marker in lowered for marker in ("mock", "sandbox", "test")) or token == "12345"


def token_preview(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-4:]}"


# Global dictionary cache to reuse active client instances
_API_CLIENT_CACHE = {}

def api_client_for(token: str | None = None):
    resolved_token = resolve_token(token)
    
    # If a valid client instance already exists for this token, reuse it!
    if resolved_token in _API_CLIENT_CACHE:
        return _API_CLIENT_CACHE[resolved_token]
        
    # Otherwise, create it ONCE
    configuration = upstox_client.Configuration()
    configuration.access_token = resolved_token
    
    client_instance = upstox_client.ApiClient(configuration)
    
    # Store it in memory for subsequent requests
    _API_CLIENT_CACHE[resolved_token] = client_instance
    return client_instance


def to_plain(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return to_plain(value.to_dict())
    if isinstance(value, list):
        return [to_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def success(data: Any, status_code: int = 200):
    return JSONResponse(status_code=status_code, content={"status": "success", "data": to_plain(data)})


def failure(message: str, status_code: int = 400, errors: list[dict[str, str]] | None = None):
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "message": message, "errors": errors or [{"message": message}]},
    )


def extract_number(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def nested_get(data: dict[str, Any], *keys: str) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def extract_ltp(feed_item: dict[str, Any]) -> float | None:
    candidates = [
        nested_get(feed_item, "ltpc", "ltp"),
        nested_get(feed_item, "fullFeed", "ltpc", "ltp"),
        nested_get(feed_item, "fullFeed", "marketFF", "ltpc", "ltp"),
        nested_get(feed_item, "fullFeed", "indexFF", "ltpc", "ltp"),
        nested_get(feed_item, "marketFullFeed", "ltpc", "ltp"),
        nested_get(feed_item, "indexFullFeed", "ltpc", "ltp"),
        nested_get(feed_item, "ltp"),
        nested_get(feed_item, "lastPrice"),
        nested_get(feed_item, "last_price"),
    ]
    for value in candidates:
        if value is not None:
            return extract_number(value, -1.0)
    return None


def extract_oi(feed_item: dict[str, Any]) -> float:
    candidates = [
        nested_get(feed_item, "oi"),
        nested_get(feed_item, "fullFeed", "oi"),
        nested_get(feed_item, "fullFeed", "marketFF", "oi"),
        nested_get(feed_item, "fullFeed", "indexFF", "oi"),
        nested_get(feed_item, "marketFullFeed", "oi"),
        nested_get(feed_item, "indexFullFeed", "oi"),
    ]
    for value in candidates:
        if value is not None:
            return extract_number(value, 0.0)
    return 0.0


def extract_volume(feed_item: dict[str, Any]) -> int:
    candidates = [
        nested_get(feed_item, "v"),
        nested_get(feed_item, "volume"),
        nested_get(feed_item, "vtt"),
        nested_get(feed_item, "fullFeed", "vtt"),
        nested_get(feed_item, "fullFeed", "marketFF", "vtt"),
        nested_get(feed_item, "fullFeed", "indexFF", "vtt"),
        nested_get(feed_item, "marketFullFeed", "vtt"),
        nested_get(feed_item, "indexFullFeed", "vtt"),
    ]
    for value in candidates:
        if value is not None:
            return int(extract_number(value, 0.0))
    return 0


def update_live_feed_from_message(message: dict[str, Any]) -> None:
    feeds = message.get("feeds", message)
    if not isinstance(feeds, dict):
        return

    changed = False
    with live_state.lock:
        for instrument_key, feed_item in feeds.items():
            if not isinstance(feed_item, dict):
                continue
            ltp = extract_ltp(feed_item)
            if ltp is None:
                continue
            volume = extract_volume(feed_item)
            live_state.ticks[instrument_key] = {
                "ltp": ltp,
                "oi": extract_oi(feed_item),
                "volume": volume,
            }
            # Store tick data for aggregation
            live_state.price_buffer[instrument_key].append((ltp, volume))
            live_state.oi_buffer[instrument_key].append(extract_oi(feed_item))
            if instrument_key == "NSE_INDEX|Nifty 50":
                live_state.prev_spot_price = live_state.spot_price or ltp
                live_state.spot_price = ltp
            changed = True
        if changed:
            live_state.last_updated = int(__import__("time").time() * 1000)


def connect_ws(token: str) -> dict[str, Any]:
    # Fetch authorized WebSocket URL if possible, mirroring the TS implementation
    token = resolve_token(token)
    if not token:
        with live_state.lock:
            live_state.ws_status = "disconnected"
            live_state.ws_error = "Missing Upstox access token"
        return {"status": "error", "message": "Missing Upstox access token"}

    if is_mock_token(token):
        with live_state.lock:
            live_state.token = token
            live_state.ws_status = "sandbox"
            live_state.ws_error = None
        return {"status": "success", "message": "Mock/sandbox feed mode active"}

    with live_state.lock:
        if live_state.streamer:
            try:
                live_state.streamer.disconnect()
            except Exception:
                pass
        live_state.token = token
        live_state.ws_status = "connecting"
        live_state.ws_error = None

    api_client = api_client_for(token)
    streamer = upstox_client.MarketDataStreamerV3(api_client)
    streamer.auto_reconnect(True, 10, 3)

    def on_open() -> None:
        with live_state.lock:
            live_state.ws_status = "connected"
            live_state.ws_error = None
        try:
            streamer.subscribe(DEFAULT_SUBSCRIPTION_KEYS, "full")
        except Exception as exc:
            on_error(exc)

    def on_message(message: dict[str, Any]) -> None:
        try:
            update_live_feed_from_message(message)
        except Exception as exc:
            on_error(exc)

    def on_error(error: Any) -> None:
        error_text = str(error)
        with live_state.lock:
            live_state.ws_error = error_text
            if "429" in error_text:
                live_state.ws_status = "rate-limited"
                rate_limit_breaker.record_failure()
            else:
                live_state.ws_status = "error"

    def on_close() -> None:
        with live_state.lock:
            if live_state.ws_status not in {"error", "disconnected"}:
                live_state.ws_status = "disconnected"

    streamer.on("open", on_open)
    streamer.on("message", on_message)
    streamer.on("error", on_error)
    streamer.on("close", on_close)

    try:
        streamer.connect()
        with live_state.lock:
            live_state.streamer = streamer
        return {"status": "success", "message": "Upstox WebSocket feed started"}
    except Exception as exc:
        with live_state.lock:
            live_state.ws_status = "error"
            live_state.ws_error = str(exc)
        return {"status": "error", "message": str(exc)}


def snapshot_feed() -> dict[str, Any]:
    with live_state.lock:
        return {
            "spotPrice": live_state.spot_price,
            "prevSpotPrice": live_state.prev_spot_price,
            "lastUpdated": live_state.last_updated,
            "ticks": dict(live_state.ticks),
            "wsStatus": live_state.ws_status,
            "wsError": live_state.ws_error,
        }


def refresh_rest_quote(token: str | None = None) -> None:
    token = resolve_token(token)
    if not token:
        return

    try:
        api = upstox_client.MarketQuoteV3Api(api_client_for(token))
        response = api.get_ltp(instrument_key=",".join(DEFAULT_SUBSCRIPTION_KEYS))
        data = to_plain(response.data)
        if not isinstance(data, dict):
            return

        updated = False
        for instrument_key, quote in data.items():
            if not isinstance(quote, dict):
                continue
            normalized_key = str(instrument_key).replace(":", "|", 1)
            ltp = quote.get("last_price") or quote.get("ltp") or quote.get("lastPrice")
            if ltp is None:
                continue
            ltp_value = extract_number(ltp, 0.0)
            oi = extract_number(quote.get("oi") or quote.get("open_interest"), 0.0)
            volume = int(extract_number(quote.get("volume") or quote.get("vtt") or quote.get("ltq"), 0.0))
            with live_state.lock:
                live_state.ticks[normalized_key] = {
                    "ltp": ltp_value,
                    "oi": oi,
                    "volume": volume,
                }
                if normalized_key == "NSE_INDEX|Nifty 50":
                    live_state.prev_spot_price = live_state.spot_price or ltp_value
                    live_state.spot_price = ltp_value
                live_state.last_updated = int(__import__("time").time() * 1000)
            updated = True

        if updated and live_state.ws_status in {"error", "disconnected"}:
            with live_state.lock:
                live_state.ws_status = "rest-fallback"
                live_state.ws_error = "WebSocket unavailable; REST LTP fallback active"
    except Exception as exc:
        if live_state.ws_status in {"error", "disconnected"}:
            with live_state.lock:
                live_state.ws_error = f"WebSocket unavailable and REST LTP fallback failed: {exc}"


def call_user_profile(token: str | None) -> Any:
    api = upstox_client.UserApi(api_client_for(token))
    return api.get_profile("2.0")


def call_user_margin(token: str | None) -> Any:
    api = upstox_client.UserApi(api_client_for(token))
    return api.get_user_fund_margin("2.0")


def call_positions(token: str | None) -> Any:
    api = upstox_client.PortfolioApi(api_client_for(token))
    return api.get_positions("2.0")


def call_holdings(token: str | None) -> Any:
    api = upstox_client.PortfolioApi(api_client_for(token))
    return api.get_holdings("2.0")


def call_option_contracts(instrument_key: str, expiry_date: str, token: str | None) -> Any:
    api = upstox_client.OptionsApi(api_client_for(token))
    kwargs = {"instrument_key": instrument_key}
    if expiry_date:
        kwargs["expiry_date"] = expiry_date
    return api.get_option_contracts(**kwargs)


def call_option_chain(instrument_key: str, expiry_date: str, token: str | None) -> Any:
    api = upstox_client.OptionsApi(api_client_for(token))
    return api.get_put_call_option_chain(instrument_key=instrument_key, expiry_date=expiry_date)





def call_intraday_candles(path: str, token: str | None) -> Any:
    parts = path.split("/")
    if len(parts) != 2:
        raise ValueError("Intraday path must be instrument_key/interval")

    instrument_key = urllib.parse.unquote(parts[0])
    interval_str = parts[1]

    if "minute" in interval_str:
        unit = "minutes"
    elif "hour" in interval_str:
        unit = "hours"
    elif "day" in interval_str:
        unit = "days"
    else:
        unit = "minutes"

    numeric_interval = "".join(filter(str.isdigit, interval_str)) or "1"

    api = upstox_client.HistoryV3Api(api_client_for(token))
    return api.get_intra_day_candle_data(
        instrument_key=instrument_key,
        unit=unit,
        interval=numeric_interval,
    )


def call_historical_candles(path: str, token: str | None) -> Any:
    parts = path.split("/")
    if len(parts) != 4:
        raise ValueError("Historical path must break down into instrument/interval/date1/date2")

    instrument_key = urllib.parse.unquote(parts[0])
    interval_str = parts[1]

    date_a = parts[2]
    date_b = parts[3]

    try:
        if datetime.strptime(date_a, "%Y-%m-%d") > datetime.strptime(date_b, "%Y-%m-%d"):
            from_date = date_b
            to_date = date_a
        else:
            from_date = date_a
            to_date = date_b
    except ValueError:
        from_date = date_b
        to_date = date_a

    if "minute" in interval_str:
        unit = "minutes"
    elif "hour" in interval_str:
        unit = "hours"
    elif "day" in interval_str:
        unit = "days"
    else:
        unit = "minutes"

    numeric_interval = "".join(filter(str.isdigit, interval_str)) or "1"

    api = upstox_client.HistoryV3Api(api_client_for(token))
    return api.get_historical_candle_data1(
        instrument_key=instrument_key,
        unit=unit,
        interval=numeric_interval,
        from_date=from_date,
        to_date=to_date,
    )


def sdk_success(result: Any):
    return success(result)


def handle_sdk_error(exc: Exception, fallback: str) -> JSONResponse:
    if isinstance(exc, ApiException):
        body = exc.body or str(exc)
        try:
            payload = json.loads(body) if isinstance(body, str) else body
        except Exception:
            payload = {"message": body}
        return failure(fallback, exc.status or 502, [{"message": str(payload)}])
    return failure(f"{fallback}: {exc}", 502)


def proxy_to_upstox(path: str, token: str, method: str, query: str, body: bytes) -> tuple[int, bytes, dict[str, str]]:
    clean_path = path.strip("/")
    url = f"{UPSTOX_BASE_V2}/{clean_path}"
    if query:
        url = f"{url}?{query}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    data = None
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        data = body if body else b"{}"
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            rate_limit_breaker.record_success()
            return response.status, response.read(), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            rate_limit_breaker.record_failure()
        return exc.code, exc.read(), dict(exc.headers.items())


def filter_proxy_headers(headers: dict[str, str]) -> dict[str, str]:
    excluded = {
        "connection",
        "content-encoding",
        "content-length",
        "date",
        "server",
        "transfer-encoding",
    }
    return {key: value for key, value in headers.items() if key.lower() not in excluded and isinstance(value, str)}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    breaker_state = rate_limit_breaker.get_state()
    return {
        "status": "ok",
        "mode": os.getenv("NODE_ENV", "development"),
        "backend": "python-fastapi",
        "cache_only_mode": CACHE_ONLY_MODE,
        "rate_limit": breaker_state
    }


@app.get("/api/upstox-config")
async def upstox_config() -> dict[str, Any]:
    token = resolve_token()
    return {
        "hasToken": bool(token),
        "mode": "server-env" if token else "client-token",
        "tokenPreview": token_preview(token),
    }


@app.post("/api/upstox/connect-env")
async def connect_env() -> JSONResponse:
    token = resolve_token()
    if not token:
        return failure("UPSTOX_ACCESS_TOKEN is not configured on the Python backend", 400)
    result = connect_ws(token)
    status_code = 200 if result["status"] == "success" else 502
    return JSONResponse(status_code=status_code, content=result)


@app.post("/api/upstox/connect-ws")
async def connect_ws_endpoint(request: Request) -> JSONResponse:
    body = await request.json()
    token = body.get("token") if isinstance(body, dict) else None
    result = connect_ws(resolve_token(token))
    status_code = 200 if result["status"] == "success" else 502
    return JSONResponse(status_code=status_code, content=result)


@app.post("/api/upstox/subscribe-ws")
async def subscribe_ws_endpoint(request: Request) -> JSONResponse:
    body = await request.json()
    keys = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(keys, list) or not keys:
        return failure("keys array parameter is required", 400)

    with live_state.lock:
        streamer = live_state.streamer
    if not streamer:
        return failure("No active Upstox feed streamer running on backend", 404)

    try:
        streamer.subscribe(keys, "full")
        return JSONResponse(content={"status": "success", "message": "Subscription delivered successfully"})
    except Exception as exc:
        return failure(str(exc), 500)


@app.get("/api/upstox-feed")
async def upstox_feed() -> dict[str, Any]:
    snapshot = snapshot_feed()
    if snapshot["spotPrice"] <= 0:
        refresh_rest_quote()
        snapshot = snapshot_feed()
    return {"status": "success", "data": snapshot}


@app.api_route("/api/upstox/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def upstox_proxy(path: str, request: Request):
    token = resolve_token(request.headers.get("authorization"))
    if not token:
        return failure("Missing Upstox ACCESS_TOKEN in Authorization header", 401)

    if CACHE_ONLY_MODE or not rate_limit_breaker.can_execute():
        if path.startswith("historical-candle/"):
            endpoint_path = path.removeprefix("historical-candle/")
            parts = endpoint_path.split("/")
            if len(parts) >= 1:
                instrument_key = urllib.parse.unquote(parts[0])
                try:
                    cached = get_cached_ohlcv(instrument_key, 200)
                    if cached:
                        return success({"candles": cached})
                except Exception:
                    pass
        if path == "user/profile":
            return failure("Cache-only mode: user/profile not available", 503)
        return failure("Cache-only mode or rate limit circuit breaker open", 503)

    query = request.url.query
    body = await request.body()
    method = request.method

    try:
        if path == "user/profile":
            result = call_user_profile(token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "user/get-margin":
            result = call_user_margin(token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "portfolio/positions":
            result = call_positions(token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "portfolio/long-term-holdings":
            result = call_holdings(token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "option/contract":
            instrument_key = request.query_params.get("instrument_key", "")
            expiry_date = request.query_params.get("expiry_date", "")
            if not instrument_key:
                return failure("instrument_key query parameter is required", 400)
            result = call_option_contracts(instrument_key, expiry_date, token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "option/chain":
            instrument_key = request.query_params.get("instrument_key", "")
            expiry_date = request.query_params.get("expiry_date", "")
            if not instrument_key or not expiry_date:
                return failure("instrument_key and expiry_date query parameters are required", 400)
            result = call_option_chain(instrument_key, expiry_date, token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path.startswith("historical-candle/intraday/"):
            result = call_intraday_candles(path.removeprefix("historical-candle/intraday/"), token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path.startswith("historical-candle/"):
            result = call_historical_candles(path.removeprefix("historical-candle/"), token)
            rate_limit_breaker.record_success()
            return sdk_success(result)
        if path == "instruments/search":
            # Proxy to Upstox instruments search endpoint for fetching real expiry dates
            status, payload, headers = proxy_to_upstox(path, token, method, query, body)
            rate_limit_breaker.record_success()
            response_headers = filter_proxy_headers(headers)
            content_type = response_headers.get("content-type", "")
            if "application/json" in content_type:
                try:
                    return JSONResponse(status_code=status, content=json.loads(payload.decode("utf-8")), headers=response_headers)
                except Exception:
                    pass
            return Response(content=payload, status_code=status, headers=response_headers)

        status, payload, headers = proxy_to_upstox(path, token, method, query, body)
        rate_limit_breaker.record_success()
        response_headers = filter_proxy_headers(headers)
        content_type = response_headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                return JSONResponse(status_code=status, content=json.loads(payload.decode("utf-8")), headers=response_headers)
            except Exception:
                pass
        return Response(content=payload, status_code=status, headers=response_headers)
    except ValueError as exc:
        return failure(str(exc), 400)
    except ApiException as exc:
        if exc.status == 429:
            rate_limit_breaker.record_failure()
        return handle_sdk_error(exc, "Upstox SDK request failed")
    except Exception as exc:
        return failure(f"Python backend Upstox gateway error: {exc}", 502)


import re
import os

TXTFILE = "INSTRUMENT_KEY_MAPPINGS_RECORD DETAILS.TXT"

_instrument_name_cache = {}

def load_instrument_mappings():
    cache = {}
    try:
        with open(TXTFILE, "r") as f:
            for line in f:
                match = re.match(r"instrument_key=(NSE_FO\|\d+),trading_symbol=(\w+)\s+(\d+)\s+(CE|PE)", line.strip())
                if match:
                    inst_key = match.group(1)
                    cache[inst_key] = f"{match.group(1)}_{match.group(2)}_{match.group(3)}"
    except:
        pass
    cache["NSE_FO|62329"] = "NIFTY_FUT"
    cache["NSE_FO|62326"] = "BANKNIFTY_FUT"
    cache["NSE_INDEX|Nifty 50"] = "NIFTY"
    return cache

if not _instrument_name_cache:
    _instrument_name_cache = load_instrument_mappings()

def get_instrument_name(inst_key: str) -> str:
    if inst_key in _instrument_name_cache:
        return _instrument_name_cache[inst_key]
    return inst_key

AGGREGATION_INTERVAL = 10  # seconds
aggregation_lock = threading.Lock()
last_known_volume = {}
stop_aggregation = threading.Event()
_batch_buffer: list[dict] = []


def _flush_batch() -> None:
    global _batch_buffer
    if not _batch_buffer:
        return
    try:
        from data.duckdb_client import bulk_write_candles
        bulk_write_candles(_batch_buffer)
    except Exception as exc:
        print(f"[AGG] batch flush failed: {exc}")
    _batch_buffer = []


def aggregate_ohlcv_loop():
    """Background thread: aggregates 1s ticks to 10s OHLCV, batch-writes to DuckDB and Redis."""
    global _batch_buffer
    while not stop_aggregation.is_set():
        stop_aggregation.wait(AGGREGATION_INTERVAL)
        if stop_aggregation.is_set():
            break
        current_ts = datetime.now()
        ts_str = current_ts.strftime("%Y-%m-%d %H:%M:%S")

        with live_state.lock:
            snapshots = {k: list(v) for k, v in live_state.price_buffer.items()}
            live_state.price_buffer.clear()

        if not snapshots:
            continue

        batch: list[dict] = []
        for inst_key, ticks in snapshots.items():
            if not ticks:
                continue
            prices = [float(t[0] if isinstance(t, (list, tuple)) else t) for t in ticks]
            volumes = [int(t[1]) if isinstance(t, (list, tuple)) and len(t) > 1 else 0 for t in ticks]
            latest_vol = volumes[-1]
            prev_vol = last_known_volume.get(inst_key, 0)
            vol_delta = max(0, latest_vol - prev_vol) if latest_vol > 0 else 0
            last_known_volume[inst_key] = latest_vol
            inst_name = get_instrument_name(inst_key)

            ohlcv = {
                "time": ts_str,
                "instrument_key": inst_key,
                "instrument_name": inst_name,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": vol_delta,
                "oi": 0
            }

            batch.append({
                "timestamp": ts_str,
                "instrument_key": inst_key,
                "instrument_name": inst_name,
                "open": prices[0],
                "high": max(prices),
                "low": min(prices),
                "close": prices[-1],
                "volume": vol_delta,
                "open_interest": 0,
            })
            cache_ohlcv(inst_key, [ohlcv])

        if batch:
            _batch_buffer.extend(batch)
            _flush_batch()


@app.get("/api/market-data/ohlcv/{instrument_key}")
async def get_market_ohlcv(instrument_key: str, limit: int = 200):
    if CACHE_ONLY_MODE or not rate_limit_breaker.can_execute():
        try:
            cached = get_cached_ohlcv(instrument_key, limit)
            if cached:
                return success({"candles": cached})
        except Exception:
            pass
        try:
            candles = read_candles(instrument_key, limit)
            return success({"candles": candles})
        except Exception:
            pass
        return failure("No cached data available in cache-only mode", 503)
    try:
        cached = get_cached_ohlcv(instrument_key, limit)
        if cached:
            return success({"candles": cached})
        candles = read_candles(instrument_key, limit)
        cache_ohlcv(instrument_key, candles)
        return success({"candles": candles})
    except Exception as e:
        return failure(f"Failed to read candles: {e}", 500)


@app.get("/api/market-data/replay/{date}")
async def get_replay_data(date: str, instrument_key: str = "NSE_INDEX|Nifty 50"):
    try:
        from data.duckdb_client import read_replay_by_date
        cached = get_cached_replay(date, instrument_key)
        if cached:
            return success({"candles": cached})
        data = read_replay_by_date(date)
        candles = data.get(instrument_key, [])
        cache_replay(date, instrument_key, candles)
        return success({"candles": candles})
    except Exception as e:
        if CACHE_ONLY_MODE:
            return failure("No cached replay data available in cache-only mode", 503)
        return failure(f"Replay data not found: {e}", 404)


@app.get("/api/market-data/instruments")
async def list_instruments():
    try:
        conn = get_connection()
        result = conn.execute("SELECT DISTINCT instrument_key, instrument_name FROM ohlcv_10s").fetchall()
        return success({"instruments": [{"key": r[0], "name": r[1]} for r in result]})
    except Exception as e:
        return failure(f"Failed to list instruments: {e}", 500)


@app.get("/api/market-data/option-chain")
async def get_option_chain():
    try:
        from data.duckdb_client import get_latest_option_chain, read_candles
        import re
        data = get_latest_option_chain()
        # Transform to match Upstox option chain format
        result = []
        seen_strikes = {}
        for item in data:
            name = item.get("instrument_name", "")
            # Parse NIFTY_24000_CE format
            import re
            match = re.match(r'NIFTY_(\d+)_(CE|PE)', name)
            if match:
                strike = int(match.group(1))
                opt_type = match.group(2)
                if strike not in seen_strikes:
                    seen_strikes[strike] = {"strike_price": strike, "call_options": None, "put_options": None}
                entry = seen_strikes[strike]
                opt_data = {
                    "trading_symbol": name,
                    "instrument_key": item["instrument_key"],
                    "market_data": {"ltp": item["ltp"], "oi": item["oi"]}
                }
                if opt_type == 'CE':
                    entry["call_options"] = opt_data
                else:
                    entry["put_options"] = opt_data
        # Convert dict to list, fill missing puts/calls
        for strike, entry in sorted(seen_strikes.items()):
            if entry["call_options"]:
                entry["put_options"] = entry["put_options"] or {"trading_symbol": f"NIFTY_{strike}_PE", "instrument_key": "", "market_data": {"ltp": 0, "oi": 0}}
            else:
                entry["call_options"] = {"trading_symbol": f"NIFTY_{strike}_CE", "instrument_key": "", "market_data": {"ltp": 0, "oi": 0}}
                entry["put_options"] = entry["put_options"]
            result.append(entry)
        # Get underlying spot price
        spot_candles = read_candles("NSE_INDEX|Nifty 50", 1)
        underlying_spot = spot_candles[0]["close"] if spot_candles else 0
        return success({"data": result, "underlying_spot_price": underlying_spot})
    except Exception as e:
        return success({"data": [], "underlying_spot_price": 0})


@app.on_event("startup")
def start_aggregation():
    import threading
    thread = threading.Thread(target=aggregate_ohlcv_loop, daemon=True)
    thread.start()
    print("Started OHLCV aggregation background thread")


@app.on_event("shutdown")
def stop_aggregation_thread():
    stop_aggregation.set()
    from data.redis_cache import close_redis
    close_redis()
    close_connection()


def static_file_response(file_path: Path) -> Response:
    content_type, _ = mimetypes.guess_type(str(file_path))
    return Response(content=file_path.read_bytes(), media_type=content_type or "application/octet-stream")


@app.get("/{full_path:path}")
async def vite_or_static(full_path: str) -> Response:
    vite_url = os.getenv("VITE_DEV_SERVER_URL", "").rstrip("/")
    if vite_url and os.getenv("NODE_ENV") != "production":
        target = f"{vite_url}/{full_path}"
        request = urllib.request.Request(target, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read()
                headers = filter_proxy_headers(dict(response.headers.items()))
                headers["content-length"] = str(len(body))
                return Response(content=body, status_code=response.status, headers=headers)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            if exc.code == 404:
                index_path = Path(__file__).resolve().parent / "dist" / "index.html"
                if index_path.exists():
                    return static_file_response(index_path)
            return Response(content=body, status_code=exc.code)
        except Exception:
            pass

    dist_dir = Path(__file__).resolve().parent / "dist"
    requested = Path(full_path or "index.html")
    if ".." in requested.parts:
        return Response(content="Invalid path", status_code=400)
    file_path = (dist_dir / requested).resolve()
    if not str(file_path).startswith(str(dist_dir.resolve())):
        return Response(content="Invalid path", status_code=400)
    if file_path.is_dir():
        file_path = file_path / "index.html"
    if not file_path.exists():
        file_path = dist_dir / "index.html"
    if not file_path.exists():
        return Response(content="Run npm run build or start the Vite dev server", status_code=404)
    return static_file_response(file_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host=APP_HOST, port=APP_PORT, reload=False)
