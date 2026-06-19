# Trading Terminal - Project Architecture

## Purpose
High-performance trading terminal dashboard with a Python FastAPI backend, Upstox SDK integration, WebSocket/live feed polling, and deterministic React UI grids.

## Ownership
- **System Architect**: Python backend, data pipeline, memory management, worker isolation
- **API Integration Specialist**: Upstox SDK calls, WebSocket feeds, data transformation, external APIs
- **UI/UX Designer**: Component layout, visual design, user interactions

## Core Architecture
- **Backend**: `server.py` is the Python FastAPI API gateway for all `/api/*` calls.
- **Frontend**: React + Vite UI calls only the Python backend endpoints.
- **Upstox credentials**: Prefer `UPSTOX_ACCESS_TOKEN` in `.env`; `config.py` may provide a local fallback.  
- **Dev run**: `npm run dev` starts Vite and the Python backend through `dev_server.py`.
- **Production run**: `npm run build` then `npm start` serves the built UI through FastAPI.

## Local Contracts
- UI API calls must use relative `/api/*` paths only.
- Python backend must never expose full access tokens through `/api/upstox-config`.
- Upstox order placement must remain explicit, confirmed, and safety-checked before any live trading action.

## Work Guidance
- Keep backend API contracts stable so existing React components can keep their endpoint names.
- Use Upstox Python SDK APIs for profile, margin, positions, option contracts, option chains, and candles.
- Use generic `/api/upstox/{path}` proxy only for endpoints not yet wrapped by typed SDK calls.
- Prefer server-env token mode for configured `.env` credentials and client token mode for manual token entry.
- Vite dev watching ignores DuckDB runtime files so backend writes to `upstox_market_data.duckdb` and its WAL do not trigger UI reload loops.

## Verification
- Python compile: `python -m py_compile server.py dev_server.py config.py UPSTOX_DATA_AGGREGATOR.py ExtractInstrumentKeys.py`
- Frontend typecheck: `npm run lint`
- Frontend build: `npm run build`
- Backend smoke: `python -m uvicorn server:app --host 127.0.0.1 --port 4000`, then `GET /api/health`

## Data Infrastructure
- **DuckDB**: `upstox_market_data.duckdb` with `ohlcv_10s` table (163,421 candles, 117 instruments)
- **Redis**: `redis://localhost:6379/0` for caching OHLCV and replay data
- **Migration**: `data/migrate_sqlite_to_duckdb.py` aggregates 1s SQLite data to 10s DuckDB candles

## Child DOX Index
No application child AGENTS.md files.
