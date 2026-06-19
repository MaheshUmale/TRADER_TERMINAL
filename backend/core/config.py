import os

DB_NAME = os.getenv("UPSTOX_DB_NAME", "upstox_data_bkp")
UPSTOX_API_VERSION = os.getenv("UPSTOX_API_VERSION", "2.0")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
DUCKDB_PATH = os.getenv("DUCKDB_PATH", "upstox_market_data.duckdb")
ACCESS_TOKEN = os.getenv("UPSTOX_ACCESS_TOKEN") or ""
SANDBOX_ACCESS_TOKEN = os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN") or os.getenv("SANDBOX_ACCESS_TOKEN") or ""
CONFIG_SANDBOX_ACCESS_TOKEN=os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN") or os.getenv("SANDBOX_ACCESS_TOKEN") or ""
CONFIG_ACCESS_TOKEN=os.getenv("UPSTOX_ACCESS_TOKEN") or ""