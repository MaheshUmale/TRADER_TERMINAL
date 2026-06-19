import duckdb
conn = duckdb.connect('upstox_market_data.duckdb')
result = conn.execute('SELECT COUNT(*) FROM ohlcv_10s').fetchone()
print(f'Total rows: {result[0]}')

# Check for today's data
today = '2026-06-19'
result = conn.execute(f"SELECT COUNT(*) FROM ohlcv_10s WHERE date(timestamp) = '{today}'").fetchone()
print(f"Rows for today ({today}): {result[0]}")

inst = conn.execute("SELECT DISTINCT instrument_key FROM ohlcv_10s LIMIT 5").fetchall()
print(f'Sample instruments: {inst}')

conn.close()