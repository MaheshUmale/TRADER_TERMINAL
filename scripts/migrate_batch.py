import sqlite3
import duckdb
import os
from datetime import datetime

SQLITE_DB = "upstox_market_data.db"
DUCKDB_PATH = "upstox_market_data_new.duckdb"

def migrate():
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    
    # Get all NSE instruments
    instr = [r[0] for r in sqlite_conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_1sec WHERE instrument_key LIKE 'NSE_%'").fetchall()]
    print(f"Found {len(instr)} NSE instruments")
    
    # Create in-memory DuckDB with migration
    con = duckdb.connect(DUCKDB_PATH)
    con.execute("DROP TABLE IF EXISTS ohlcv_10s")
    con.execute("""
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
    
    for inst_key in instr:
        # Get instrument name
        name = inst_key.replace("NSE_FO|", "")
        if inst_key == "NSE_INDEX|Nifty 50":
            name = "NIFTY"
        try:
            n = int(name)
            if 23000 <= n <= 25000: name = f"NIFTY_{n}"
            elif 56000 <= n <= 60000: name = f"BANKNIFTY_{n}"
            elif n == 62329: name = "NIFTY_FUT"
            elif n == 62326: name = "BANKNIFTY_FUT"
        except: pass
        
        # Read and convert in batches
        cur = sqlite_conn.execute(f"SELECT timestamp, open, high, low, close, volume FROM ohlcv_1sec WHERE instrument_key = ?", (inst_key,))
        batch = []
        for row in cur:
            ts = row[0]
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts)
            sec = int(ts.timestamp()) // 10 * 10
            batch.append((datetime.fromtimestamp(sec), inst_key, name, row[1], row[2], row[3], row[4], row[5], 0))
        
        if batch:
            # Deduplicate by timestamp
            seen = {}
            for b in batch:
                key = (b[0], b[1])
                if key not in seen:
                    seen[key] = b
            
            for b in seen.values():
                con.execute("INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", b)
            
            print(f"{inst_key}: {len(seen)} candles as {name}")
    
    con.commit()
    sqlite_conn.close()
    con.close()
    
    # Verify
    con = duckdb.connect(DUCKDB_PATH)
    total = con.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]
    print(f"Total candles: {total}")
    con.close()

if __name__ == "__main__":
    migrate()