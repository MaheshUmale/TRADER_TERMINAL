import sqlite3
import duckdb
import re
import os
from datetime import datetime
from collections import defaultdict

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

def migrate_fast():
    # Clean existing
    if os.path.exists("upstox_market_data.duckdb"):
        os.remove("upstox_market_data.duckdb")
    
    sqlite_conn = sqlite3.connect("upstox_market_data.db")
    duck_conn = duckdb.connect("upstox_market_data.duckdb")
    
    key_to_name = get_all_instrument_mappings()
    instruments = list(key_to_name.keys())
    print(f"Processing {len(instruments)} instruments")
    
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
    
    # Get OI data
    oi_rows = sqlite_conn.execute("SELECT instrument_key, timestamp, open_interest FROM oi_1min").fetchall()
    oi_lookup = {(inst, ts[:16] + ':00'): oi for inst, ts, oi in oi_rows}
    
    all_values = []
    for inst_key in instruments:
        inst_name = key_to_name[inst_key]
        
        rows = sqlite_conn.execute(
            "SELECT timestamp, open, high, low, close, volume FROM ohlcv_1sec WHERE instrument_key = ? ORDER BY timestamp",
            (inst_key,)
        ).fetchall()
        
        if not rows:
            continue
        
        buckets = defaultdict(lambda: {'opens': [], 'highs': [], 'lows': [], 'closes': [], 'vols': []})
        for ts, o, h, l, c, v in rows:
            try:
                dt = datetime.fromisoformat(ts) if isinstance(ts, str) else ts
            except:
                continue
            sec = int(dt.timestamp()) // 10 * 10
            buckets[sec]['opens'].append(float(o))
            buckets[sec]['highs'].append(float(h))
            buckets[sec]['lows'].append(float(l))
            buckets[sec]['closes'].append(float(c))
            buckets[sec]['vols'].append(int(v or 0))
        
        # Get OI values for this instrument
        inst_oic = {ts: oi for (inst, ts), oi in oi_lookup.items() if inst == inst_key}
        
        for sec, data in buckets.items():
            ts = datetime.fromtimestamp(sec)
            oi = inst_oic.get(ts.strftime('%Y-%m-%d %H:%M:%S'), 0)
            all_values.append((
                ts.isoformat(), inst_key, inst_name, 
                data['opens'][0], max(data['highs']), min(data['lows']), data['closes'][-1], 
                sum(data['vols']), oi
            ))
        
        print(f"{inst_key}: {len(buckets)} candles")
    
    print(f"\nTotal: {len(all_values)} candles")
    
    # Bulk insert
    duck_conn.executemany(
        "INSERT INTO ohlcv_10s VALUES (CAST(? AS TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?)",
        all_values
    )
    
    duck_conn.commit()
    
    result = duck_conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
    inst_result = duck_conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
    print(f"\nFinal: {result[0]} rows, {inst_result[0]} instruments")
    
    sqlite_conn.close()
    duck_conn.close()

if __name__ == "__main__":
    migrate_fast()