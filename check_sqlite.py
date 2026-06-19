import sqlite3
import os

sql_path = r'D:\scratchpad-main\upstox_market_data_19_JUN_2026.db'
if not os.path.exists(sql_path):
    print(f"File not found: {sql_path}")
    exit(1)

conn = sqlite3.connect(sql_path)

# Check tables
cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cursor.fetchall()]
print(f"Tables: {tables}")

# Check schema of each table
for table in tables:
    cursor = conn.execute(f"PRAGMA table_info({table})")
    cols = cursor.fetchall()
    print(f"\n{table} schema:")
    for col in cols:
        print(f"  {col}")
    
    # Get row count
    cursor = conn.execute(f"SELECT COUNT(*) FROM {table}")
    count = cursor.fetchone()[0]
    print(f"  Row count: {count}")