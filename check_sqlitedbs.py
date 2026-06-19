import sqlite3
import os

for db_name in ['upstox_market_data.db', 'upstox_market_data_19_JUN_2026.db']:
    path = f'D:\\scratchpad-main\\{db_name}'
    print(f"\n=== {db_name} ===")
    
    try:
        conn = sqlite3.connect(path)
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall()]
        print(f"Tables: {tables}")
        
        for table in tables:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count} rows")
        conn.close()
    except Exception as e:
        print(f"Error: {e}")