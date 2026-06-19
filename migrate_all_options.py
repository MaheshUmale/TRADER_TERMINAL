import duckdb

# DuckDB can read SQLite directly via httpfs extension or we can use Python
# Let's use DuckDB's sqlite_scan if available, otherwise use a simple iter

con = duckdb.connect("upstox_market_data.duckdb")

# First, let's check if the instrument_name column is there
try:
    con.execute("SELECT instrument_name FROM ohlcv_10s LIMIT 1").fetchone()
    print("instrument_name column exists")
except:
    print("adding instrument_name column")
    con.execute("ALTER TABLE ohlcv_10s ADD COLUMN instrument_name VARCHAR")

con.close()

# Now do a fast migration using pandas-style batch
import sqlite3
from datetime import datetime
from collections import defaultdict

sqlite_conn = sqlite3.connect("upstox_market_data.db")
sqlite_conn.row_factory = sqlite3.Row

con = duckdb.connect("upstox_market_data.duckdb")

# Get all NSE instruments
instruments = [r[0] for r in sqlite_conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_1sec WHERE instrument_key LIKE 'NSE_%'").fetchall()]
print(f"Migrating {len(instruments)} instruments...")

for inst_key in instruments:
    # Calculate name
    name = inst_key.replace("NSE_FO|", "")
    if inst_key == "NSE_INDEX|Nifty 50":
        name = "NIFTY"
    try:
        n = int(name)
        if 23000 <= n <= 25000: name = f"NIFTY_{n}"
        elif 56000 <= n <= 60000: name = f"BANKNIFTY_{n}"
        elif n == 62329: name = "NIFTY_FUT"
        elif n == 62326: name = "BANKNIFTY_FUT"
        else: name = f"NSE_FO_{n}"
    except: name = inst_key
    
    # Read and aggregate in one query using SQLite's strftime
    rows = sqlite_conn.execute(f"""
        SELECT 
            datetime(CAST(strftime('%s', timestamp) AS INTEGER) - (strftime('%s', timestamp) % 10), 'unixepoch') as ts,
            open, high, low, close, volume
        FROM ohlcv_1sec
        WHERE instrument_key = ?
    """, (inst_key,)).fetchall()
    
    if not rows:
        continue
    
    # Aggregate by timestamp
    agg = {}
    for r in rows:
        ts = r[0]
        key = ts
        if key not in agg:
            agg[key] = {"open": [], "high": [], "low": [], "close": [], "vol": []}
        agg[key]["open"].append(float(r[1]))
        agg[key]["high"].append(float(r[2]))
        agg[key]["low"].append(float(r[3]))
        agg[key]["close"].append(float(r[4]))
        agg[key]["vol"].append(int(r[5] or 0))
    
    # Insert
    for ts, data in agg.items():
        con.execute(
            "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ts, inst_key, name, data["open"][0], max(data["high"]), min(data["low"]), data["close"][-1], sum(data["vol"]), 0)
        )
    
    print(f"{inst_key}: {len(agg)} rows as {name}")

con.commit()
sqlite_conn.close()

# Verify
con = duckdb.connect("upstox_market_data.duckdb")
total = con.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]
unique = con.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()[0]
print(f"Total candles: {total}, Instruments: {unique}")
con.close()