import duckdb
import os
import threading
from typing import Optional, Any, List, Dict
import anyio

DATABASE = os.getenv("DUCKDB_PATH", "upstox_market_data.duckdb")

_local = threading.local()
_write_lock = threading.Lock()


def _init_db(conn: duckdb.DuckDBPyConnection):
    """Initialize database schema and set optimized PRAGMAs."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv_10s (
            timestamp TIMESTAMP,
            instrument_key VARCHAR,
            instrument_name VARCHAR,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume BIGINT,
            open_interest BIGINT
        )
    """)
    # Performance & Concurrency Tuning
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA checkpoint_threshold='10MB'")
    conn.execute("PRAGMA threads=4")
    # Allow multiple readers while writing
    conn.execute("PRAGMA access_mode='READ_WRITE'")


def get_connection() -> duckdb.DuckDBPyConnection:
    """Get a thread-local DuckDB connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = duckdb.connect(DATABASE)
        _init_db(_local.conn)
    return _local.conn


async def close_connection() -> None:
    """Close the thread-local connection if it exists."""
    def _close():
        if hasattr(_local, "conn") and _local.conn is not None:
            try:
                _local.conn.execute("CHECKPOINT;")
                _local.conn.close()
            except Exception:
                pass
            _local.conn = None
    await anyio.to_thread.run_sync(_close)


async def write_candle(instrument_key: str, ts: str, open_v: float, high_v: float,
                 low_v: float, close_v: float, volume_v: int, oi_v: int = 0,
                 inst_name: str = "") -> None:
    """Write a single candle to DuckDB (Async)."""
    def _write():
        with _write_lock:
            conn = get_connection()
            conn.execute(
                "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ts, instrument_key, inst_name, open_v, high_v, low_v, close_v, volume_v, oi_v)
            )
    await anyio.to_thread.run_sync(_write)


async def read_candles(instrument_key: str, limit: int = 200) -> List[Dict[str, Any]]:
    """Read historical candles from DuckDB (Async)."""
    def _read():
        conn = get_connection()
        result = conn.execute(
            """SELECT timestamp, instrument_key, instrument_name, open, high, low, close,
                      volume, open_interest
               FROM ohlcv_10s
               WHERE instrument_key = ?
               ORDER BY timestamp DESC
               LIMIT ?""",
            (instrument_key, limit)
        ).fetchall()
        return [{
            "time": str(r[0]),
            "instrument_key": r[1],
            "instrument_name": r[2],
            "open": r[3],
            "high": r[4],
            "low": r[5],
            "close": r[6],
            "volume": r[7],
            "oi": r[8]
        } for r in result]
    return await anyio.to_thread.run_sync(_read)


async def get_latest_option_chain() -> List[Dict[str, Any]]:
    """Retrieve latest option chain snapshot from DuckDB (Async)."""
    def _read():
        conn = get_connection()
        result = conn.execute(
            """SELECT instrument_key, instrument_name, close, open_interest
               FROM ohlcv_10s
               WHERE instrument_key LIKE 'NSE_FO%'
               AND timestamp = (SELECT MAX(timestamp) FROM ohlcv_10s)"""
        ).fetchall()
        return [{
            "instrument_key": r[0],
            "instrument_name": r[1],
            "ltp": r[2],
            "oi": r[3]
        } for r in result]
    return await anyio.to_thread.run_sync(_read)


async def read_replay_by_date(date_str: str) -> Dict[str, List[Dict]]:
    """Fetch all data for a specific date for replay purposes (Async)."""
    def _read():
        conn = get_connection()
        result = conn.execute(
            """SELECT instrument_key, instrument_name, timestamp, open, high, low, close,
                      volume, open_interest
               FROM ohlcv_10s
               WHERE date(timestamp) = ?""",
            (date_str,)
        ).fetchall()
        output: Dict[str, List[Dict]] = {}
        for row in result:
            inst_key = row[0]
            if inst_key not in output:
                output[inst_key] = []
            output[inst_key].append({
                "time": str(row[2]),
                "instrument_key": inst_key,
                "instrument_name": row[1],
                "open": row[3],
                "high": row[4],
                "low": row[5],
                "close": row[6],
                "volume": row[7],
                "oi": row[8]
            })
        return output
    return await anyio.to_thread.run_sync(_read)


async def bulk_write_candles(rows: List[Dict[str, Any]]) -> None:
    """Insert micro-batches of candles to reduce I/O pressure (Async)."""
    if not rows:
        return
    def _write():
        with _write_lock:
            conn = get_connection()
            data = [
                (
                    r["timestamp"],
                    r["instrument_key"],
                    r.get("instrument_name", ""),
                    float(r["open"]),
                    float(r["high"]),
                    float(r["low"]),
                    float(r["close"]),
                    int(r["volume"]),
                    int(r.get("open_interest", 0)),
                )
                for r in rows
            ]
            conn.executemany(
                "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                data,
            )
            if len(rows) >= 50:
                try:
                    conn.execute("CHECKPOINT;")
                except Exception:
                    pass
    await anyio.to_thread.run_sync(_write)


async def get_all_instruments() -> List[Dict[str, str]]:
    """Retrieve unique instrument list from DuckDB (Async)."""
    def _read():
        conn = get_connection()
        result = conn.execute("SELECT DISTINCT instrument_key, instrument_name FROM ohlcv_10s").fetchall()
        return [{"key": r[0], "name": r[1]} for r in result]
    return await anyio.to_thread.run_sync(_read)
