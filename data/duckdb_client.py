import duckdb
import os
from typing import Optional, Any

DATABASE = os.getenv("DUCKDB_PATH", "upstox_market_data.duckdb")
_Connection: Optional[duckdb.DuckDBPyConnection] = None


def _force_checkpoint_and_cleanup() -> None:
    """
    Force-checkpoint any stale WAL into the main database file, then delete WAL/tmp.
    This prevents Vite reload loops and data loss on unclean prior shutdown.
    """
    wal = f"{DATABASE}.wal"
    tmp = f"{DATABASE}.tmp"
    if not os.path.exists(DATABASE):
        for p in (wal, tmp):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
        return
    try:
        conn = duckdb.connect(DATABASE)
        conn.execute("PRAGMA checkpoint")
        conn.close()
    except Exception:
        pass
    for p in (wal, tmp):
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def get_connection() -> duckdb.DuckDBPyConnection:
    global _Connection
    if _Connection is None:
        _force_checkpoint_and_cleanup()
        _Connection = duckdb.connect(DATABASE)
        _Connection.execute("""
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
        _Connection.execute("PRAGMA checkpoint_threshold='10MB'")
        _Connection.execute("CHECKPOINT;")
    return _Connection


def close_connection() -> None:
    global _Connection
    if _Connection is not None:
        try:
            _Connection.execute("CHECKPOINT;")
            _Connection.close()
        except Exception:
            pass
        _Connection = None
        for p in (f"{DATABASE}.wal", f"{DATABASE}.tmp"):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


def write_candle(instrument_key: str, ts: str, open_v: float, high_v: float,
                 low_v: float, close_v: float, volume_v: int, oi_v: int = 0,
                 inst_name: str = "") -> None:
    conn = get_connection()
    conn.execute(
        "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ts, instrument_key, inst_name, open_v, high_v, low_v, close_v, volume_v, oi_v)
    )


def read_candles(instrument_key: str, limit: int = 200) -> list[dict[str, Any]]:
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


def get_latest_option_chain() -> list[dict[str, Any]]:
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


def read_replay_by_date(date_str: str) -> dict[str, list[dict]]:
    conn = get_connection()
    result = conn.execute(
        """SELECT instrument_key, instrument_name, timestamp, open, high, low, close,
                  volume, open_interest
           FROM ohlcv_10s
           WHERE date(timestamp) = ?""",
        (date_str,)
    ).fetchall()
    output: dict[str, list[dict]] = {}
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


def bulk_write_candles(rows: list[dict]) -> None:
    """
    Insert many candles in a single transaction. Dramatically reduces WAL pressure.
    Each row dict must have: timestamp, instrument_key, instrument_name,
    open, high, low, close, volume, open_interest.
    """
    if not rows:
        return
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
    if len(rows) >= 100:
        try:
            conn.execute("CHECKPOINT;")
        except Exception:
            pass