"""
Options Chain Builder.

Builds a mini options chain for a given underlying across multiple strikes.
For each strike, fetches CE and PE LTPs and displays them side-by-side.

Usage:
  python options_analytics/options_chain_builder.py --token <TOKEN>
  python options_analytics/options_chain_builder.py --token <TOKEN> --query BANKNIFTY --strikes 5
"""

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from utils import get_api_client, search_instrument, get_ltp


def main():
    # parser = argparse.ArgumentParser(description="Build a live options chain")
    # parser.add_argument("--token", required=True, help="Upstox access token or analytics token")
    # parser.add_argument("--query", default="NIFTY", help="Underlying symbol (default: NIFTY)")
    # parser.add_argument("--expiry", default="current_month", help="Expiry (default: current_month)")
    # parser.add_argument("--strikes", type=int, default=5,
    #                     help="Number of strikes on each side of ATM (default: 5)")
    # args = parser.parse_args()

    client = get_api_client('eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI3NkFGMzUiLCJqdGkiOiI2YTM0Yzg0MDlkZDI5ZTQ0ODJiOWNhZjciLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlhdCI6MTc4MTg0NDAzMiwiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxNzgxOTA2NDAwfQ.Fp-IM4j5m30burFVcRCb8_KDQwHqvGl1PttzXT13pHg')
    query ='NIFTY'
    expiry='current_month'
    strikes=2
    print(f"Building options chain for { query} ({expiry}), ±{strikes} strikes from ATM...\n")

    # Fetch CE and PE across offsets -strikes to +strikes
    offsets = range(-strikes, strikes + 1)
    ce_instruments = {}
    pe_instruments = {}

    for offset in offsets:
        ce_resp = search_instrument(client, query, exchanges="NSE", segments="FO",
                                    instrument_types="CE", expiry=expiry,
                                    atm_offset=offset, records=1)
        pe_resp = search_instrument(client, query, exchanges="NSE", segments="FO",
                                    instrument_types="PE", expiry=expiry,
                                    atm_offset=offset, records=1)
        ce_list = ce_resp.data or []
        pe_list = pe_resp.data or []
        if ce_list:
            inst = ce_list[0]
            ce_instruments[inst.get("strike_price", 0)] = inst
            print(inst)
            # print( f"name={inst['name']},expiry={inst['expiry'] },instrument_key={inst['instrument_key']},exchange_token={inst['exchange_token']},trading_symbol={inst['trading_symbol']} ,strike_price={inst['strike_price']}")
            # print( f"instrument_key={inst['instrument_key']},,trading_symbol={inst['trading_symbol']}")
        if pe_list:
            inst = pe_list[0]
            pe_instruments[inst.get("strike_price", 0)] = inst
            # print( f"instrument_key={inst['instrument_key']},trading_symbol={inst['trading_symbol']}  ")

    all_strikes = sorted(set(list(ce_instruments.keys()) + list(pe_instruments.keys())))
    
    # print(all_strikes)
    
    # if not all_strikes:
    #     print("No options data found.")
    #     sys.exit(1)

    # # Batch LTP fetch
    # all_keys = []
    # for k in all_strikes:
    #     if k in ce_instruments:
    #         all_keys.append(ce_instruments[k]["instrument_key"])
    #     if k in pe_instruments:
    #         all_keys.append(pe_instruments[k]["instrument_key"])

    # ltp_data = get_ltp(client, *all_keys)

    # def get_price(inst):
    #     key = inst["instrument_key"]
    #     return ltp_data[key].last_price if key in ltp_data else 0.0

    # # Determine ATM
    # atm_resp = search_instrument(client, query, exchanges="NSE", segments="FO",
    #                              instrument_types="CE", expiry=expiry, atm_offset=0, records=1)
    # atm_strike = (atm_resp.data or [{}])[0].get("strike_price", 0)

    # print(f"{'CALL LTP':>12}  {'CALL OI':>10}  {'STRIKE':^10}  {'PUT OI':>10}  {'PUT LTP':>12}")
    # print("-" * 65)

    # for strike in reversed(all_strikes):
    #     ce_inst = ce_instruments.get(strike)
    #     pe_inst = pe_instruments.get(strike)
    #     ce_ltp  = get_price(ce_inst) if ce_inst else 0.0
    #     pe_ltp  = get_price(pe_inst) if pe_inst else 0.0

    #     atm_marker = " <<< ATM" if strike == atm_strike else ""
    #     print(f"{ce_ltp:>12.2f}  {'N/A':>10}  {strike:^10.0f}  {'N/A':>10}  {pe_ltp:>12.2f}{atm_marker}")

    # print("\nNote: OI data requires get_full_market_quote (see options_analytics/oi_skew.py).")


if __name__ == "__main__":
    main()
