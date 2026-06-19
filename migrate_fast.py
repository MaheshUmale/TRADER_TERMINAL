import duckdb
import os

def migrate_sqlite_to_duckdb_fast(sqlite_path, duckdb_path):
    """Migrate SQLite 1s data to DuckDB 10s candles - fast version"""
    
    if os.path.exists(duckdb_path):
        os.remove(duckdb_path)
    
    conn = duckdb.connect(duckdb_path)
    
    # Read both tables using DuckDB's SQLite reader
    print(f"Reading {sqlite_path}...")
    
    # Create table from SQLite data with aggregation in SQL
    conn.execute(f"""
        CREATE TABLE ohlcv_10s AS
        SELECT 
            datetime(timestamp, 'start of minute', printf('+%d seconds', (CAST(strftime('%S', timestamp) AS INTEGER) / 10) * 10)) as timestamp,
            instrument_key,
            CASE 
                WHEN instrument_key LIKE '%Nifty 50%' THEN 'NIFTY'
                ELSE instrument_key
            END as instrument_name,
            FIRST(open) as open,
            MAX(high) as high,
            MIN(low) as low,
            LAST(close) as close,
            SUM(volume) as volume,
            0 as open_interest
        FROM read_sqlite('{sqlite_path}', 'ohlcv_1sec')
        GROUP BY instrument_key, 
                 datetime(timestamp, 'start of minute', printf('+%d seconds', (CAST(strftime('%S', timestamp) AS INTEGER) / 10) * 10))
        ORDER BY timestamp, instrument_key
    """)
    
    conn.commit()
    
    result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
    inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
    print(f"{duckdb_path}: {result[0]} rows, {inst_result[0]} instruments")
    
    conn.close()

# Historical migration
migrate_sqlite_to_duckdb_fast(
    'D:\\scratchpad-main\\upstox_market_data.db',
    'TEMP_18jun.duckdb'
)

# Today's data
migrate_sqlite_to_duckdb_fast(
    'D:\\scratchpad-main\\upstox_market_data_19_JUN_2026.db',
    'TEMP_today.duckdb'
)

print("\nDone!")