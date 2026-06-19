import sqlite3
import duckdb
import os
from datetime import datetime

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

# Read all data from SQLite
print("Reading SQLite data...")
sqlite_conn = sqlite3.connect("upstox_market_data.db")
rows = sqlite_conn.execute(
    "SELECT instrument_key, timestamp, open, high, low, close, volume FROM ohlcv_1sec ORDER BY instrument_key, timestamp"
).fetchall()
sqlite_conn.close()
print(f"Read {len(rows)} rows")

# Aggregate to 10s in Python using pandas
import pandas as pd
df = pd.DataFrame(rows, columns=['instrument_key', 'timestamp', 'open', 'high', 'low', 'close', 'volume'])

# Parse timestamp
df['ts_parsed'] = pd.to_datetime(df['timestamp'])
df['bucket'] = df['ts_parsed'].dt.floor('10s')

# Aggregate
agg = df.groupby(['instrument_key', 'bucket']).agg({
    'open': 'first',
    'high': 'max',
    'low': 'min',
    'close': 'last',
    'volume': 'sum'
}).reset_index()

agg = agg.rename(columns={'bucket': 'timestamp'})

# Add instrument_name
def get_inst_name(key):
    if 'Nifty 50' in key:
        return 'NIFTY'
    return key

agg['instrument_name'] = agg['instrument_key'].apply(get_inst_name)
agg['open_interest'] = 0

print(f"Aggregated to {len(agg)} rows")

# Write to DuckDB
conn.execute("INSERT INTO ohlcv_10s SELECT timestamp, instrument_key, instrument_name, open, high, low, close, volume, open_interest FROM agg")
conn.commit()

result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
print(f"Done: {result[0]} rows, {inst_result[0]} instruments")

conn.close()