import duckdb
import sqlite3
import re

DATABASE = "upstox_market_data.duckdb"

def get_instrument_name(inst_key: str) -> str:
    if inst_key == "NSE_INDEX|Nifty 50":
        return "NIFTY"
    if inst_key == "NSE_FO|62329":
        return "NIFTY_FUT"
    if inst_key == "NSE_FO|62326":
        return "BANKNIFTY_FUT"
    
    with open("INSTRUMENT_KEY_MAPPINGS_RECORD DETAILS.TXT", "r") as f:
        for line in f:
            match = re.match(r"instrument_key=" + inst_key + r",trading_symbol=(\w+)\s+(\d+)\s+(CE|PE)", line.strip())
            if match:
                return f"{match.group(1)}_{match.group(2)}_{match.group(3)}"
    return inst_key

def migrate():
    sqlite_conn = sqlite3.connect("upstox_market_data.db")
    sqlite_conn.row_factory = sqlite3.Row
    
    duck_conn = duckdb.connect(DATABASE)
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
    
    instruments = [r[0] for r in sqlite_conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_1sec WHERE instrument_key LIKE 'NSE_%'").fetchall()]
    print(f"Found {len(instruments)} instruments")
    
    total = 0
    for inst_key in instruments:
        rows = sqlite_conn.execute("SELECT * FROM ohlcv_1sec WHERE instrument_key = ?", (inst_key,)).fetchall()
        if not rows:
            continue
        
        inst_name = get_instrument_name(inst_key)
        
        # Aggregate to 10s
        agg = {}
        for r in rows:
            ts = r[0]
            key = ts[:19] if len(ts) >= 19 else ts  # truncate to seconds
            # Round down to 10s
            if 'T' in ts:
                time_part = ts.split('T')[1]
                sec = int(time_part.split(':')[2][:2])
                key = ts[:19].replace(time_part[:9], time_part[:6] + f"{sec - sec % 10:02d}")
            if key not in agg:
                agg[key] = {"open": [], "high": [], "low": [], "close": [], "vol": []}
            agg[key]["open"].append(float(r[1] or 0))
            agg[key]["high"].append(float(r[2] or 0))
            agg[key]["low"].append(float(r[3] or 0))
            agg[key]["close"].append(float(r[4] or 0))
            agg[key]["vol"].append(int(r[5] or 0))
        
        for ts, data in agg.items():
            duck_conn.execute(
                "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (ts, inst_key, inst_name, data["open"][0], max(data["high"]), min(data["low"]), data["close"][-1], sum(data["vol"]), 0)
            )
        total += len(agg)
        print(f"{inst_key} ({inst_name}): {len(agg)} candles")
    
    duck_conn.commit()
    sqlite_conn.close()
    duck_conn.close()
    print(f"Total: {total} candles")

if __name__ == "__main__":
    migrate()