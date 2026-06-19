import sqlite3
import duckdb
import os
from datetime import datetime

def migrate_sql_agg():
    # Clean up
    if os.path.exists("upstox_market_data.duckdb"):
        os.remove("upstox_market_data.duckdb")
    
    # Create DuckDB connection
    conn = duckdb.connect("upstox_market_data.duckdb")
    
    # Load sqlite table into DuckDB using sqlite3 and register as view
    sqlite_conn = sqlite3.connect("upstox_market_data.db")
    
    # Get all unique instruments
    insts = sqlite_conn.execute(
        "SELECT DISTINCT instrument_key FROM ohlcv_1sec ORDER BY instrument_key"
    ).fetchall()
    print(f"Found {len(insts)} instruments in SQLite")
    
    # Load data in chunks and process
    for i, (inst_key,) in enumerate(insts):
        rows = sqlite_conn.execute(
            "SELECT timestamp, open, high, low, close, volume FROM ohlcv_1sec WHERE instrument_key = ? ORDER BY timestamp",
            (inst_key,)
        ).fetchall()
        
        if not rows:
            continue
        
        # Load into temp table
        conn.execute("CREATE TEMP TABLE tmp_ohlcv AS SELECT * FROM (VALUES (NULL::VARCHAR, NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE, NULL::BIGINT)) t WHERE FALSE")
        
        for ts, o, h, l, c, v in rows:
            conn.execute(
                "INSERT INTO tmp_ohlcv VALUES (?, ?, ?, ?, ?, ?)",
                (ts, o, h, l, c, v)
            )
        
        # Aggregate to 10s buckets
        conn.execute(f"""
            INSERT INTO ohlcv_10s
            SELECT 
                datetime(strftime(timestamp, '%Y-%m-%d %H:%M') || ':' || (CAST(strftime('%S', timestamp) AS INTEGER) / 10) * 10) as timestamp,
                '{inst_key}' as instrument_key,
                '{inst_key}' as instrument_name,
                FIRST(open) as open,
                MAX(high) as high,
                MIN(low) as low,
                LAST(close) as close,
                SUM(volume) as volume,
                0 as open_interest
            FROM tmp_ohlcv
            GROUP BY datetime(strftime(timestamp, '%Y-%m-%d %H:%M') || ':' || (CAST(strftime('%S', timestamp) AS INTEGER) / 10) * 10)
        """)
        
        print(f"{inst_key}: done ({i+1}/{len(insts)})")
    
    sqlite_conn.close()
    conn.commit()
    
    result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
    print(f"\nTotal candles: {result[0]}")
    conn.close()

# First create the table
conn = duckdb.connect("upstox_market_data.duckdb")
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
conn.close()

migrate_sql_agg()