import duckdb
import os

TEMP_DB = 'TEMP_DATA.duckdb'

print("Checking temp DB...")
temp_conn = duckdb.connect(TEMP_DB)
temp_count = temp_conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]
print(f"Temp DB has {temp_count} rows")

date_range = temp_conn.execute(
    "SELECT MIN(date(timestamp)), MAX(date(timestamp)) FROM ohlcv_10s"
).fetchone()
print(f"Date range: {date_range}")

# Read temp data into memory
temp_data = temp_conn.execute(
    "SELECT timestamp, instrument_key, instrument_name, open, high, low, close, volume, open_interest FROM ohlcv_10s"
).fetchall()
temp_conn.close()

print(f"Read {len(temp_data)} rows from temp DB")

print("\nAppending to main DB...")
main_conn = duckdb.connect('upstox_market_data.duckdb')

# Get existing count
old_count = main_conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]
print(f"Main DB has {old_count} rows before merge")

# Just insert all temp data (append mode)
for row in temp_data:
    main_conn.execute(
        "INSERT INTO ohlcv_10s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        row
    )

main_conn.commit()

# Verify
new_count = main_conn.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]
print(f"Main DB now has {new_count} rows (added {new_count - old_count})")

main_conn.close()
print("Merge complete!")