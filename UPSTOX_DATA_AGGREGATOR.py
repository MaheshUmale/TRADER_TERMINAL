import os
import time
import sqlite3
import threading
from collections import defaultdict
import upstox_client
from config import ACCESS_TOKEN, SANDBOX_ACCESS_TOKEN
import ExtractInstrumentKeys
# --- CONFIGURATION ---
ACCESS_TOKEN = ACCESS_TOKEN or os.getenv("UPSTOX_ACCESS_TOKEN") or os.getenv("ACCESS_TOKEN") or ""
SANDBOX_ACCESS_TOKEN = SANDBOX_ACCESS_TOKEN or os.getenv("UPSTOX_SANDBOX_ACCESS_TOKEN") or os.getenv("SANDBOX_ACCESS_TOKEN") or ""
DB_NAME = "upstox_market_data.db"








instrument_symbol_map = {}
subscribed_instruments = set()
INSTRUMENT_KEYS = set()
INSTRUMENT_KEYS.add("NSE_INDEX|Nifty 50")

try:
    res = ExtractInstrumentKeys.getNiftyAndBNFnOKeys()
    if isinstance(res, tuple):
        keys, symbol_map = res
        if keys:
            INSTRUMENT_KEYS.update(keys)
        if symbol_map:
            instrument_symbol_map.update(symbol_map)
    else:
        if res:
            subscribed_instruments.update(res)
            INSTRUMENT_KEYS.update(res)
except Exception as e:
    print(f"Error extracting F&O keys: {e}")

# Thread-safe storage structures
price_buffer = defaultdict(list)  # Stores list of tuples: (price, volume)
oi_buffer = defaultdict(list)     # Stores list of integers: (open_interest)
lock = threading.Lock()

# Global state to keep track of previous cumulative volume
last_known_volume = {}

# Lifecycle control flag to stop background threads cleanly
stop_event = threading.Event()

def init_database():
    """Initializes the SQLite database with high-performance indexing."""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ohlcv_1sec (
            timestamp TEXT,
            instrument_key TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            PRIMARY KEY (timestamp, instrument_key)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS oi_1min (
            timestamp TEXT,
            instrument_key TEXT,
            open_interest INTEGER,
            PRIMARY KEY (timestamp, instrument_key)
        )
    ''')
    conn.commit()
    conn.close()
    print("Database structures checked and confirmed online.")

def aggregate_and_save_loop():
    """Runs continuously in a background thread. Flushes aggregated results to SQLite."""
    global last_known_volume
    print("Data aggregator loop actively polling...")
    
    while not stop_event.is_set():
        stop_event.wait(1.0)
        if stop_event.is_set():
            break
            
        current_time_epoch = time.time()
        sec_timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(current_time_epoch))
        
        # 1. Safely snapshot and clear memory buffers
        with lock:
            active_price = dict(price_buffer)
            price_buffer.clear()
            
            # Flush OI data right on the minute boundary (e.g., at 00 seconds)
            active_oi = None
            if int(current_time_epoch) % 60 == 0:
                active_oi = dict(oi_buffer)
                oi_buffer.clear()
                min_timestamp = time.strftime("%Y-%m-%d %H:%M:00", time.localtime(current_time_epoch))

        # 2. Write snapshot payload to SQLite
        if active_price or active_oi:
            try:
                conn = sqlite3.connect(DB_NAME)
                cursor = conn.cursor()
                
                inserted_ohlcv_count = 0
                # Write 1-Sec OHLCV Data
                for inst_key, ticks in active_price.items():
                    if ticks:
                        # FIX: Unzip list of tuples into separate float/int arrays
                        prices = [float(t[0]) for t in ticks]
                        volumes = [int(t[1]) for t in ticks]
                        
                        # Get the latest cumulative volume snapshot in this 1-sec window
                        latest_cumulative_volume = volumes[-1]
                        prev_volume = last_known_volume.get(inst_key, 0)
                        
                        # Calculate true 1-second volume delta
                        if prev_volume == 0 or latest_cumulative_volume < prev_volume:
                            sec_volume_delta = 0 
                        else:
                            sec_volume_delta = latest_cumulative_volume - prev_volume
                        
                        # Update historic tracking dictionary
                        if latest_cumulative_volume > 0:
                            last_known_volume[inst_key] = latest_cumulative_volume
                        
                        ohlcv_row = (
                            sec_timestamp,
                            inst_key,
                            prices[0],          # Open (Single Float)
                            max(prices),        # High (Single Float)
                            min(prices),        # Low (Single Float)
                            prices[-1],         # Close (Single Float)
                            sec_volume_delta    # Volume Delta (Single Int)
                        )
                        cursor.execute('INSERT OR REPLACE INTO ohlcv_1sec VALUES (?, ?, ?, ?, ?, ?, ?)', ohlcv_row)
                        inserted_ohlcv_count += 1
                
                # Write 1-Min OI Data
                inserted_oi_count = 0
                if active_oi:
                    for inst_key, oi_values in active_oi.items():
                        if oi_values:
                            latest_oi = oi_values[-1]
                            cursor.execute('INSERT OR REPLACE INTO oi_1min VALUES (?, ?, ?)', (min_timestamp, inst_key, int(latest_oi)))
                            inserted_oi_count += 1
                            
                conn.commit()
                conn.close()
                
                # Diagnostics print to let you track writes instantly
                if inserted_ohlcv_count > 0:
                    print(f"[{sec_timestamp}] DB Flush: Saved {inserted_ohlcv_count} candles to ohlcv_1sec.")
                if active_oi and inserted_oi_count > 0:
                    print(f"[{min_timestamp}] DB Flush: Saved {inserted_oi_count} records to oi_1min.")
                    
            except Exception as db_err:
                print(f"Database write error encountered: {db_err}")
            
    print("Data aggregator engine stopped cleanly.")

def on_message(message):
    global price_buffer, oi_buffer
    try:
        # Handle dict or string object mappings defensively
        if not isinstance(message, dict):
            data_dict = message.to_dict() if hasattr(message, 'to_dict') else dict(message)
        else:
            data_dict = message

        # Extract feeds mapping
        feeds = data_dict.get("feeds", data_dict)
        if not feeds or not isinstance(feeds, dict):
            return

        with lock:
            for inst_key, instrument_data in feeds.items():
                if not isinstance(instrument_data, dict):
                    continue

                full_feed = instrument_data.get("fullFeed", {})
                if not full_feed or not isinstance(full_feed, dict):
                    continue

                ltp = None
                volume = 0
                oi = None

                # --- PATH A: PROCESS OPTIONS / DERIVATIVES (marketFF) ---
                if "marketFF" in full_feed:
                    market_ff = full_feed.get("marketFF", {})
                    if isinstance(market_ff, dict):
                        ltpc = market_ff.get("ltpc", {})
                        if isinstance(ltpc, dict):
                            ltp = ltpc.get("ltp")
                        
                        vtt_str = market_ff.get("vtt", "0")
                        volume = int(vtt_str) if vtt_str else 0
                        
                        oi_val = market_ff.get("oi")
                        if oi_val is not None:
                            oi = int(oi_val)

                # --- PATH B: PROCESS INDICES (indexFF) ---
                elif "indexFF" in full_feed:
                    index_ff = full_feed.get("indexFF", {})
                    if isinstance(index_ff, dict):
                        # FIX: Correct nesting path configuration for V3 Indices
                        ltpc = index_ff.get("ltpc", {})
                        if isinstance(ltpc, dict):
                            ltp = ltpc.get("ltp")
                        volume = 0
                        oi = None

                # --- WRITE DATA BACK TO PROCESSING AGGREGATORS ---
                if ltp is not None:
                    price_buffer[inst_key].append((float(ltp), int(volume)))

                if oi is not None:
                    oi_buffer[inst_key].append(int(oi))
                    
    except Exception as e:
        print(f"Error parsing live stream chunk: {e}")

def on_open(streamer):
    print("WebSocket pipeline verified online.")
    subscription_list = list(INSTRUMENT_KEYS)
    streamer.subscribe(subscription_list, "full")
    print(f"Successfully subscribed to {len(subscription_list)} instruments.")


def main():
    init_database()
    
    configuration = upstox_client.Configuration()
    configuration.access_token = ACCESS_TOKEN
    api_client = upstox_client.ApiClient(configuration)
    
    streamer = upstox_client.MarketDataStreamerV3(api_client)
    streamer.on("open", lambda: on_open(streamer))
    streamer.on("message", on_message)
    streamer.on("error", lambda err: print(f"Upstox Client Error: {err}"))
    
    db_thread = threading.Thread(target=aggregate_and_save_loop)
    db_thread.daemon = True  
    db_thread.start()
    
    try:
        print("Connecting upstream to Upstox streaming servers... Press Ctrl+C to stop.")
        streamer.connect()
        
        # --- FIX: KEEP MAIN THREAD ALIVE ---
        # This prevents the script from immediately jumping to the 'finally' block
        print("Stream connected. Processing live ticks...")
        while not stop_event.is_set():
            time.sleep(1)  # Keeps the main thread alive smoothly
            
    except KeyboardInterrupt:
        print("\nShutdown requested by user.")
        stop_event.set()
    finally:
        # Signal the loop thread to gracefully terminate 
        stop_event.set()
        db_thread.join(timeout=2.0)
        print("Application exit complete.")



if __name__ == "__main__":
    main()
