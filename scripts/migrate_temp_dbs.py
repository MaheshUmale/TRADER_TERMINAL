import sqlite3
import duckdb
import os
from datetime import datetime

def migrate_sqlite_to_duckdb(sqlite_path, duckdb_path):
    """Migrate SQLite 1s data to DuckDB 10s candles"""
    
    # Remove existing if present
    if os.path.exists(duckdb_path):
        os.remove(duckdb_path)
    
    # Create fresh DuckDB
    conn = duckdb.connect(duckdb_path)
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
    print(f"Reading from {sqlite_path}...")
    sql_conn = sqlite3.connect(sqlite_path)
    
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
    
    # Aggregate to 10s candles
    bucket_data = {}
    for ts, inst_key, o, h, l, c, v in ohlcv_rows:
        try:
            dt = datetime.fromisoformat(ts.replace('Z', '').replace('+00:00', ''))
        except:
            continue
        bucket_ts = dt.replace(second=(dt.second // 10) * 10, microsecond=0)
        bucket_key = (inst_key, bucket_ts.isoformat())
        
        if bucket_key not in bucket_data:
            bucket_data[bucket_key] = {'open': o, 'high': h, 'low': l, 'close': c, 'volume': v, 'oi': oi_data.get((inst_key, ts[:16] + ':00'), 0)}
        else:
            bucket_data[bucket_key]['high'] = max(bucket_data[bucket_key]['high'], h)
            bucket_data[bucket_key]['low'] = min(bucket_data[bucket_key]['low'], l)
            bucket_data[bucket_key]['close'] = c
            bucket_data[bucket_key]['volume'] += v
    
    print(f"Aggregated to {len(bucket_data)} 10s candles")
    
    # Insert into DuckDB in batches
    values_list = []
    for (inst_key, ts), data in bucket_data.items():
        inst_name = inst_key.replace('NSE_INDEX|Nifty 50', 'NIFTY')
        values_list.append((ts, inst_key, inst_name, data['open'], data['high'], data['low'], data['close'], data['volume'], data['oi']))
    
    conn.executemany(
        "INSERT INTO ohlcv_10s (timestamp, instrument_key, instrument_name, open, high, low, close, volume, open_interest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        values_list
    )
    
    conn.commit()
    
    result = conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()
    inst_result = conn.execute("SELECT COUNT(DISTINCT instrument_key) FROM ohlcv_10s").fetchone()
    print(f"Final: {result[0]} rows, {inst_result[0]} unique instruments")
    
    conn.close()
    print(f"Created {duckdb_path}\n")

# Migrate historical (18jun) data
migrate_sqlite_to_duckdb(
    'D:\\scratchpad-main\\upstox_market_data.db',
    'TEMP_18jun.duckdb'
)

# Migrate today's data (19jun)  
migrate_sqlite_to_duckdb(
    'D:\\scratchpad-main\\upstox_market_data_19_JUN_2026.db',
    'TEMP_today.duckdb'
)