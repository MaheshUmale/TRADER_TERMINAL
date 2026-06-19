import sqlite3
import duckdb
import os
from datetime import datetime

# Source SQLite
SQLITE_PATH = r'D:\scratchpad-main\upstox_market_data_19_JUN_2026.db'
# Destination DuckDB
TEMP_DUCKDB = 'TEMP_DATA.duckdb'

# Remove existing temp db if exists
if os.path.exists(TEMP_DUCKDB):
    os.remove(TEMP_DUCKDB)

# Create DuckDB with matching schema
conn = duckdb.connect(TEMP_DUCKDB)
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

# Read from SQLite and aggregate to 10s candles
print("Reading 1s OHLCV data from SQLite...")
sql_conn = sqlite3.connect(SQLITE_PATH)

# Get unique instruments
cursor = sql_conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_1sec")
instruments = [r[0] for r in cursor.fetchall()]
print(f"Found {len(instruments)} instruments")

# Get OI data for forward-filling
oi_data = {}
oi_cursor = sql_conn.execute("SELECT instrument_key, timestamp, open_interest FROM oi_1min")
for row in oi_cursor.fetchall():
    key = (row[0], row[1])
    oi_data[key] = row[2]

print(f"Loaded {len(oi_data)} OI records")

# Process each instrument
for inst_key in instruments[:10]:  # Limit for testing
    print(f"Processing {inst_key}...")
    
    # Get all ticks ordered by time
    cursor = sql_conn.execute(
        "SELECT timestamp, open, high, low, close, volume FROM ohlcv_1sec WHERE instrument_key = ? ORDER BY timestamp",
        (inst_key,)
    )
    rows = cursor.fetchall()
    
    # Group into 10-second buckets
    bucket_data = {}
    for ts, o, h, l, c, v in rows:
        # Truncate timestamp to 10-second bucket
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00').replace('+00:00', ''))
        bucket_ts = dt.replace(second=(dt.second // 10) * 10, microsecond=0)
        bucket_key = (inst_key, bucket_ts.isoformat())
        
        if bucket_key not in bucket_data:
            bucket_data[bucket_key] = {
                'open': o, 'high': h, 'low': l, 'close': c, 'volume': v
            }
        else:
            bucket_data[bucket_key]['high'] = max(bucket_data[bucket_key]['high'], h)
            bucket_data[bucket_key]['low'] = min(bucket_data[bucket_key]['low'], l)
            bucket_data[bucket_key]['close'] = c
            bucket_data[bucket_key]['volume'] += v
    
    print(f"  Aggregated {len(bucket_data)} 10s candles")
    
    # Insert into DuckDB with OI forward-fill
    for (inst, ts), data in bucket_data.items():
        oi_key = (inst, ts[:16] + '0' if len(ts) > 16 else ts)  # Match 1min OI buckets
        oi_val = oi_data.get(oi_key, 0)
        
        # Derive instrument name
        inst_name = inst.replace('NSE_INDEX|Nifty 50', 'NIFTY')
        if inst.startswith('NSE_FO|'):
            import re
            m = re.search(r'(\d+)_([CP]E)', inst)
            if m:
                inst_name = f"NIFTY_{m.group(1)}_{m.group(2)}"
        
        conn.execute(
            "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, inst, inst_name, data['open'], data['high'], data['low'], data['close'], data['volume'], oi_val)
        )

conn.commit()

# Verify
result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
print(f"\nTemp DuckDB created with {result[0]} rows")
instruments_result = conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_10s LIMIT 5").fetchall()
print(f"Sample instruments: {instruments_result}")

conn.close()
sql_conn.close()
print("Migration to TEMP_DATA.duckdb complete!")