import sqlite3
import duckdb
import re
from datetime import datetime
from collections import defaultdict

DATABASE = "upstox_market_data.duckdb"

def get_all_instrument_mappings():
    key_to_name = {}
    with open("INSTRUMENT_KEY_MAPPINGS_RECORD DETAILS.TXT", "r") as f:
        for line in f:
            match = re.match(r"instrument_key=(NSE_FO\|\d+),trading_symbol=(\w+)\s+(\d+)\s+(CE|PE)", line.strip())
            if match:
                inst_key = match.group(1)
                symbol_type = match.group(2)
                strike = match.group(3)
                opt_type = match.group(4)
                key_to_name[inst_key] = f"{symbol_type}_{strike}_{opt_type}"
    key_to_name["NSE_FO|62329"] = "NIFTY_FUT"
    key_to_name["NSE_FO|62326"] = "BANKNIFTY_FUT"
    key_to_name["NSE_INDEX|Nifty 50"] = "NIFTY"
    return key_to_name

def migrate():
    sqlite_conn = sqlite3.connect("upstox_market_data.db")
    duck_conn = duckdb.connect(DATABASE)
    
    key_to_name = get_all_instrument_mappings()
    instruments = list(key_to_name.keys())
    
    duck_conn.execute("DROP TABLE IF EXISTS ohlcv_10s")
    duck_conn.execute("""
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
    
    total = 0
    for inst_key in instruments:
        inst_name = key_to_name[inst_key]
        
        rows = sqlite_conn.execute(
            "SELECT timestamp, open, high, low, close, volume FROM ohlcv_1sec WHERE instrument_key = ? ORDER BY timestamp",
            (inst_key,)
        ).fetchall()
        
        if not rows:
            print(f"{inst_key}: NO DATA")
            continue
        
        buckets = defaultdict(list)
        for r in rows:
            ts = datetime.fromisoformat(r[0]) if isinstance(r[0], str) else r[0]
            sec = int(ts.timestamp()) // 10 * 10
            buckets[sec].append(r)
        
        for sec, rlist in buckets.items():
            prices = [float(r[1]) for r in rlist]
            highs = [float(r[2]) for r in rlist]
            lows = [float(r[3]) for r in rlist]
            vols = [int(r[5] or 0) for r in rlist]
            
            duck_conn.execute(
                "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (datetime.fromtimestamp(sec), inst_key, inst_name, prices[0], max(highs), min(lows), prices[-1], sum(vols), 0)
            )
        
        total += len(buckets)
        print(f"{inst_key} ({inst_name}): {len(buckets)} candles")
    
    duck_conn.commit()
    sqlite_conn.close()
    duck_conn.close()
    print(f"Done: {total} total candles")

if __name__ == "__main__":
    migrate()