import sqlite3
import duckdb
import os
from datetime import datetime

def migrate_sqlite_to_duckdb(sqlite_path, duckdb_path):
    """Migrate SQLite 1s data to DuckDB 10s candles"""
    
    if os.path.exists(duckdb_path):
        os.remove(duckdb_path)
    
    conn = duckdb.connect(duckdb_path)
    conn.execute("""
        CREATE TABLE ohlcv_10s (
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
    
    print(f"Reading {sqlite_path}...")
    sql_conn = sqlite3.connect(sqlite_path)
    
    # Read all data
    ohlcv_rows = sql_conn.execute(
        "SELECT timestamp, instrument_key, open, high, low, close, volume FROM ohlcv_1sec"
    ).fetchall()
    
    oi_rows = sql_conn.execute(
        "SELECT instrument_key, timestamp, open_interest FROM oi_1min"
    ).fetchall()
    
    sql_conn.close()
    print(f"OHLCV: {len(ohlcv_rows)} rows, OI: {len(oi_rows)} records")
    
    # Build OI lookup
    oi_lookup = {(inst, ts[:16] + ':00'): oi for inst, ts, oi in oi_rows}
    
    # Process in chunks
    chunk_size = 100000
    all_values = []
    
    for ts, inst_key, o, h, l, c, v in ohlcv_rows:
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '').replace('+00:00', ''))
        except:
            continue
        
        bucket_ts = dt.replace(second=(dt.second // 10) * 10, microsecond=0)
        inst_name = 'NIFTY' if 'Nifty 50' in inst_key else inst_key
        oi = oi_lookup.get((inst_key, bucket_ts.strftime('%Y-%m-%d %H:%M:%S')))
        
        all_values.append((
            bucket_ts.isoformat(), inst_key, inst_name, o, h, l, c, v, oi if oi else 0
        ))
    
    print(f"Aggregated to {len(all_values)} entries")
    
    # Insert in chunks
    for i in range(0, len(all_values), chunk_size):
        chunk = all_values[i:i+chunk_size]
        conn.executemany(
            "INSERT INTO ohlcv_10s (timestamp, instrument_key, instrument_name, open, high, low, close, volume, open_interest) VALUES (CAST(? AS TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?)",
            [(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]) for v in chunk]
        )
    
    conn.commit()
    
    result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
    inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
    print(f"{duckdb_path}: {result[0]} rows, {inst_result[0]} instruments\n")
    conn.close()

migrate_sqlite_to_duckdb(
    'D:\\scratchpad-main\\upstox_market_data.db',
    'TEMP_18jun.duckdb'
)

migrate_sqlite_to_duckdb(
    'D:\\scratchpad-main\\upstox_market_data_19_JUN_2026.db',
    'TEMP_today.duckdb'
)

print("Done!")