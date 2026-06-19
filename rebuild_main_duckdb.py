import sqlite3
import duckdb
import os
from datetime import datetime

SQLITE_PATH = 'upstox_market_data.db'
MAIN_DB = 'upstox_market_data.duckdb'

# Remove existing db if exists
if os.path.exists(MAIN_DB):
    os.remove(MAIN_DB)

# Create fresh DuckDB with schema
conn = duckdb.connect(MAIN_DB)
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

# Read from SQLite
print("Reading from SQLite...")
sql_conn = sqlite3.connect(SQLITE_PATH)

# Get tables
cursor = sql_conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cursor.fetchall()]
print(f"SQLite tables: {tables}")

# Read all OHLCV 1s data
cursor = sql_conn.execute("SELECT timestamp, instrument_key, open, high, low, close, volume FROM ohlcv_1sec")
ohlcv_rows = cursor.fetchall()
print(f"Read {len(ohlcv_rows)} OHLCV rows")

# Read OI data
oi_data = {}
oi_cursor = sql_conn.execute("SELECT instrument_key, timestamp, open_interest FROM oi_1min")
for row in oi_cursor.fetchall():
    oi_data[(row[0], row[1])] = row[2]
print(f"Loaded {len(oi_data)} OI records")

sql_conn.close()

# Aggregate to 10s and insert
# Group by instrument and 10s bucket
bucket_data = {}
for ts, inst_key, o, h, l, c, v in ohlcv_rows:
    # Parse timestamp and bucket to 10s
    try:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00').replace('+00:00', ''))
    except:
        continue
    bucket_ts = dt.replace(second=(dt.second // 10) * 10, microsecond=0)
    bucket_key = (inst_key, bucket_ts.isoformat())
    
    if bucket_key not in bucket_data:
        bucket_data[bucket_key] = {'open': o, 'high': h, 'low': l, 'close': c, 'volume': v}
    else:
        bucket_data[bucket_key]['high'] = max(bucket_data[bucket_key]['high'], h)
        bucket_data[bucket_key]['low'] = min(bucket_data[bucket_key]['low'], l)
        bucket_data[bucket_key]['close'] = c
        bucket_data[bucket_key]['volume'] += v

print(f"Aggregated to {len(bucket_data)} 10s candles")

# Insert into DuckDB
for (inst_key, ts), data in bucket_data.items():
    # Derive instrument name
    inst_name = inst_key.replace('NSE_INDEX|Nifty 50', 'NIFTY')
    if inst_key.startswith('NSE_FO|'):
        import re
        m = re.search(r'\d+_([CP]E)', inst_key)
        if m:
            # Extract strike from instrument_key if possible
            inst_name = f"NIFTY_{inst_key}"
    
    # Find matching OI
    oi_val = oi_data.get((inst_key, ts[:16] + ':00'), 0)
    
    conn.execute(
        "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ts, inst_key, inst_name, data['open'], data['high'], data['low'], data['close'], data['volume'], oi_val)
    )

conn.commit()

# Verify
result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
print(f"\nFinal DuckDB has {result[0]} rows")

# Check unique instruments
inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
print(f"Unique instruments: {inst_result[0]}")

conn.close()
print("Complete!")