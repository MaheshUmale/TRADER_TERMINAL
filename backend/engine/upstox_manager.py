import asyncio
import logging
import time
import re
import os
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple

import upstox_client
from backend.core.config import ACCESS_TOKEN, SANDBOX_ACCESS_TOKEN
from backend.db.duckdb_client import bulk_write_candles
from backend.db.redis_cache import cache_ohlcv

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("UpstoxManager")

TXTFILE = "scripts/INSTRUMENT_KEY_MAPPINGS_RECORD DETAILS.TXT"


class UpstoxManager:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.access_token = ACCESS_TOKEN or os.getenv("UPSTOX_ACCESS_TOKEN") or ""
        self.streamer: Optional[upstox_client.MarketDataStreamerV3] = None

        self.lock = asyncio.Lock()
        self.data_queue = asyncio.Queue()

        # State
        self.ticks: Dict[str, Dict[str, Any]] = {}
        self.spot_price = 0.0
        self.prev_spot_price = 0.0
        self.ws_status = "disconnected"
        self.ws_error = None

        # Buffers for aggregation
        self.price_buffer = defaultdict(list)
        self.oi_buffer = defaultdict(list)
        self.last_known_volume = {}

        self.instrument_name_cache = self._load_instrument_mappings()
        self.aggregation_interval = 10  # seconds
        self._stop_event = asyncio.Event()

    def _load_instrument_mappings(self) -> Dict[str, str]:
        cache = {
            "NSE_FO|62329": "NIFTY_FUT",
            "NSE_FO|62326": "BANKNIFTY_FUT",
            "NSE_INDEX|Nifty 50": "NIFTY"
        }
        if os.path.exists(TXTFILE):
            try:
                with open(TXTFILE, "r") as f:
                    for line in f:
                        match = re.match(r"instrument_key=(NSE_FO\|\d+),trading_symbol=(\w+)\s+(\d+)\s+(CE|PE)", line.strip())
                        if match:
                            inst_key = match.group(1)
                            cache[inst_key] = f"{match.group(2)}_{match.group(3)}_{match.group(4)}"
            except Exception as e:
                logger.error(f"Error loading instrument mappings: {e}")
        return cache

    def get_instrument_name(self, inst_key: str) -> str:
        return self.instrument_name_cache.get(inst_key, inst_key)

    async def connect(self, token: Optional[str] = None):
        if token:
            self.access_token = token

        if not self.access_token:
            self.ws_status = "error"
            self.ws_error = "Missing Access Token"
            return

        configuration = upstox_client.Configuration()
        configuration.access_token = self.access_token
        api_client = upstox_client.ApiClient(configuration)

        self.streamer = upstox_client.MarketDataStreamerV3(api_client)
        self.streamer.auto_reconnect(True, 10, 5)

        self.streamer.on("open", self._on_open)
        self.streamer.on("message", self._on_message)
        self.streamer.on("error", self._on_error)
        self.streamer.on("close", self._on_close)

        try:
            self.ws_status = "connecting"
            await asyncio.to_thread(self.streamer.connect)
            logger.info("Upstox Streamer connected")
        except Exception as e:
            self.ws_status = "error"
            self.ws_error = str(e)
            logger.error(f"Failed to connect Upstox streamer: {e}")

    def _on_open(self):
        self.ws_status = "connected"
        self.ws_error = None
        logger.info("Upstox WebSocket opened")
        self.streamer.subscribe(["NSE_INDEX|Nifty 50"], "full")

    def _on_message(self, message):
        self.loop.call_soon_threadsafe(self.data_queue.put_nowait, message)

    def _on_error(self, error):
        logger.error(f"Upstox Streamer Error: {error}")
        self.ws_error = str(error)
        if "429" in str(error):
            self.ws_status = "rate-limited"

    def _on_close(self):
        logger.info("Upstox WebSocket closed")
        if self.ws_status != "error":
            self.ws_status = "disconnected"

    async def process_messages_loop(self):
        while not self._stop_event.is_set():
            try:
                message = await asyncio.wait_for(self.data_queue.get(), timeout=1.0)
                await self._handle_message(message)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Error in process_messages_loop: {e}")

    async def _handle_message(self, message):
        feeds = message.get("feeds", message)
        if not isinstance(feeds, dict):
            return

        async with self.lock:
            for inst_key, feed_item in feeds.items():
                ltp = self._extract_ltp(feed_item)
                if ltp is None:
                    continue

                volume = self._extract_volume(feed_item)
                oi = self._extract_oi(feed_item)

                self.ticks[inst_key] = {
                    "ltp": ltp,
                    "oi": oi,
                    "volume": volume,
                    "timestamp": time.time()
                }

                self.price_buffer[inst_key].append((ltp, volume))
                self.oi_buffer[inst_key].append(oi)

                if inst_key == "NSE_INDEX|Nifty 50":
                    self.prev_spot_price = self.spot_price or ltp
                    self.spot_price = ltp

    def _extract_ltp(self, item: Any) -> Optional[float]:
        for path in ["ltpc.ltp", "fullFeed.ltpc.ltp", "fullFeed.marketFF.ltpc.ltp",
                     "fullFeed.indexFF.ltpc.ltp", "marketFullFeed.ltpc.ltp",
                     "indexFullFeed.ltpc.ltp", "ltp", "lastPrice", "last_price"]:
            val = self._nested_get(item, path.split("."))
            if val is not None:
                try:
                    return float(val)
                except (ValueError, TypeError):
                    continue
        return None

    def _extract_volume(self, item: Any) -> int:
        for path in ["v", "volume", "vtt", "fullFeed.vtt", "fullFeed.marketFF.vtt",
                     "fullFeed.indexFF.vtt", "marketFullFeed.vtt", "indexFullFeed.vtt"]:
            val = self._nested_get(item, path.split("."))
            if val is not None:
                try:
                    return int(float(val))
                except (ValueError, TypeError):
                    continue
        return 0

    def _extract_oi(self, item: Any) -> int:
        for path in ["oi", "fullFeed.oi", "fullFeed.marketFF.oi",
                     "fullFeed.indexFF.oi", "marketFullFeed.oi", "indexFullFeed.oi"]:
            val = self._nested_get(item, path.split("."))
            if val is not None:
                try:
                    return int(float(val))
                except (ValueError, TypeError):
                    continue
        return 0

    def _nested_get(self, data: Any, keys: List[str]) -> Any:
        for key in keys:
            if isinstance(data, dict):
                data = data.get(key)
            else:
                return None
        return data

    async def aggregation_loop(self):
        while not self._stop_event.is_set():
            await asyncio.sleep(self.aggregation_interval)

            async with self.lock:
                snapshots = {k: list(v) for k, v in self.price_buffer.items()}
                self.price_buffer.clear()

                oi_snapshots = {k: list(v) for k, v in self.oi_buffer.items()}
                self.oi_buffer.clear()

            if not snapshots:
                continue

            ts_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            batch = []

            for inst_key, ticks in snapshots.items():
                prices = [t[0] for t in ticks]
                volumes = [t[1] for t in ticks]

                latest_vol = volumes[-1]
                prev_vol = self.last_known_volume.get(inst_key, 0)
                vol_delta = max(0, latest_vol - prev_vol) if latest_vol > 0 else 0
                self.last_known_volume[inst_key] = latest_vol

                inst_name = self.get_instrument_name(inst_key)
                oi = oi_snapshots.get(inst_key, [0])[-1]

                ohlcv = {
                    "timestamp": ts_str,
                    "instrument_key": inst_key,
                    "instrument_name": inst_name,
                    "open": prices[0],
                    "high": max(prices),
                    "low": min(prices),
                    "close": prices[-1],
                    "volume": vol_delta,
                    "open_interest": oi,
                }
                batch.append(ohlcv)
                await cache_ohlcv(inst_key, [{
                    "time": ts_str,
                    "open": prices[0],
                    "high": max(prices),
                    "low": min(prices),
                    "close": prices[-1],
                    "volume": vol_delta,
                    "oi": oi
                }])

            if batch:
                await bulk_write_candles(batch)
                logger.info(f"Aggregated and saved {len(batch)} instruments at {ts_str}")

    def stop(self):
        self._stop_event.set()
        if self.streamer:
            self.streamer.disconnect()

    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "spotPrice": self.spot_price,
            "prevSpotPrice": self.prev_spot_price,
            "lastUpdated": int(time.time() * 1000),
            "ticks": self.ticks,
            "wsStatus": self.ws_status,
            "wsError": self.ws_error,
        }
