import duckdb
import os

# Remove old DB
if os.path.exists("upstox_market_data.duckdb"):
    os.remove("upstox_market_data.duckdb")

conn = duckdb.connect("upstox_market_data.duckdb")

# Create the table
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

# Read and aggregate SQLite data in one SQL operation
conn.execute("""
    INSTALL sqlite; LOAD sqlite;
    INSERT INTO ohlcv_10s
    SELECT 
        strftime(strftime('%Y-%m-%d %H:%M:%S', timestamp), '%Y-%m-%d %H:%M', 'start of minute', '+' || ((CAST(strftime('%S', timestamp) AS INTEGER) / 10) * 10) || ' seconds') as timestamp,
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
    FROM sqlite_scan('upstox_market_data.db', 'ohlcv_1sec')
    GROUP BY instrument_key, (CAST(strftime('%S', timestamp) AS INTEGER) / 10)
    ORDER BY instrument_key, timestamp
""")

conn.commit()

result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
print(f"Total: {result[0]} rows, {inst_result[0]} instruments")

conn.close()