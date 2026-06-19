import duckdb
import re

con = duckdb.connect("upstox_market_data.duckdb")

key_to_symbol = {}

with open("INSTRUMENT_KEY_MAPPINGS_RECORD DETAILS.TXT", "r") as f:
    for line in f:
        match = re.match(r"instrument_key=(NSE_FO\|\d+),trading_symbol=(\w+)\s+(\d+)\s+(CE|PE)", line.strip())
        if match:
            inst_key = match.group(1)
            symbol_type = match.group(2)  # NIFTY or BANKNIFTY
            strike = match.group(3)     # 23500, etc.
            opt_type = match.group(4)   # CE or PE
            key_to_symbol[inst_key] = f"{symbol_type}_{strike}_{opt_type}"

print(f"Loaded {len(key_to_symbol)} key mappings from TXT file")

# Also add futures and indexes
key_to_symbol["NSE_FO|62329"] = "NIFTY_FUT"
key_to_symbol["NSE_FO|62326"] = "BANKNIFTY_FUT"
key_to_symbol["NSE_INDEX|Nifty 50"] = "NIFTY"

# Update DuckDB
updated = 0
for inst_key, symbol in key_to_symbol.items():
    result = con.execute(
        "UPDATE ohlcv_10s SET instrument_name = ? WHERE instrument_key = ?",
        (symbol, inst_key)
    ).rowcount
    updated += result

con.commit()

# Verify
total_raw = con.execute("SELECT COUNT(*) FROM ohlcv_10s WHERE instrument_name LIKE 'NSE_FO%'").fetchone()[0]
total_nifty = con.execute("SELECT COUNT(*) FROM ohlcv_10s WHERE instrument_name LIKE 'NIFTY%'").fetchone()[0]
total_banknifty = con.execute("SELECT COUNT(*) FROM ohlcv_10s WHERE instrument_name LIKE 'BANKNIFTY%'").fetchone()[0]
total_all = con.execute("SELECT COUNT(*) FROM ohlcv_10s").fetchone()[0]

print(f"Updated {updated} rows")
print(f"Total raw NSE_FO names remaining: {total_raw}")
print(f"NIFTY names: {total_nifty}")
print(f"BANKNIFTY names: {total_banknifty}")
print(f"Total candles: {total_all}")

con.close()