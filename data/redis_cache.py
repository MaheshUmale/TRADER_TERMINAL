import os
import json
from typing import Any, Optional
from datetime import datetime

import redis as sync_redis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "86400"))

_redis_client: Optional[sync_redis.Redis] = None


def get_redis() -> sync_redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = sync_redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def close_redis():
    global _redis_client
    if _redis_client is not None:
        try:
            _redis_client.close()
        except Exception:
            pass
        _redis_client = None


def cache_ohlcv(instrument_key: str, candles: list[dict], ttl: int = CACHE_TTL_SECONDS):
    client = get_redis()
    key = f"cache:ohlcv:{instrument_key}"
    for c in candles:
        ts = c.get("time")
        try:
            if isinstance(ts, str):
                score = int(datetime.fromisoformat(ts).timestamp() * 1000)
            elif ts:
                score = int(ts)
            else:
                score = 0
        except Exception:
            continue
        if score > 0:
            client.zadd(key, {json.dumps(c): score})
    client.expire(key, ttl)


def get_cached_ohlcv(instrument_key: str, limit: int = 200) -> list[dict]:
    client = get_redis()
    key = f"cache:ohlcv:{instrument_key}"
    raw = client.zrevrange(key, 0, limit - 1, withscores=True)
    return [json.loads(r[0]) for r in raw]


def cache_replay(date_str: str, instrument_key: str, candles: list[dict]):
    client = get_redis()
    key = f"cache:replay:{date_str}:{instrument_key}"
    client.delete(key)
    for c in candles:
        client.rpush(key, json.dumps(c))
    client.expire(key, 7 * 86400)


def get_cached_replay(date_str: str, instrument_key: str) -> list[dict]:
    client = get_redis()
    key = f"cache:replay:{date_str}:{instrument_key}"
    raw = client.lrange(key, 0, -1)
    return [json.loads(r) for r in raw]


def add_instrument(instrument_key: str):
    client = get_redis()
    client.sadd("cache:instruments", instrument_key)


def get_instruments() -> list[str]:
    client = get_redis()
    raw = client.smembers("cache:instruments")
    return list(raw)
