# IMPLEMENTATION FIX PLAN

## Identified Issues & Fixes Required

### Issue 1: DuckDB Syntax Error (CRITICAL)
**File:** data/duckdb_client.py line 33
**Problem:** INSERT OR REPLACE INTO is SQLite syntax, invalid in DuckDB
**Fix:** Replace with standard INSERT (DuckDB auto-handles conflicts) or use:
`sql
INSERT INTO ohlcv_10s VALUES (...) ON CONFLICT DO NOTHING
`
Or simply remove duplicate check since we aggregate by time windows

### Issue 2: Async/Sync Architecture Conflict (CRITICAL)
**Files:** data/redis_cache.py, server.py
**Problem:** redis_cache.py uses async but server.py endpoints are sync
**Fix Options:**
- A) Convert market-data endpoints to async (recommended)
- B) Use redis.Redis (sync) instead of redis.asyncio
**Decision:** Convert to async for better performance

### Issue 3: Missing Dependencies
**File:** requirements.txt
**Add:**
`
duckdb>=1.0.0
redis[hiredis]>=5.0.0
`

### Issue 4: Migration Script Incomplete
**File:** data/migrate_sqlite_to_duckdb.py line 37
**Problem:** instruments[:10] limits to 10 instruments only
**Fix:** Remove the limit, add error handling, migrate oi_1min table

### Issue 5: Duplicate Aggregation Logic
**Files:** server.py, UPSTOX_DATA_AGGREGATOR.py
**Problem:** Both have separate price_buffer/oi_buffer implementations
**Fix:** Remove UPSTOX_DATA_AGGREGATOR.py, keep only server.py version

### Issue 6: Missing Environment Variables
**File:** .env.example
**Add:**
`
REDIS_URL=redis://localhost:6379/0
DUCKDB_PATH=upstox_market_data.duckdb
CACHE_TTL_SECONDS=86400
