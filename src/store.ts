import { create } from 'zustand';
import { Candlestick, Position, Order, MarketSignal, OptionChainRow, UpstoxProfile, UpstoxMargin } from './types';

const SERVER_ENV_TOKEN = 'SERVER_ENV_TOKEN';

function isServerEnvToken(token: string) {
  return token === SERVER_ENV_TOKEN;
}

interface TerminalState {
  // Connection and Mode States
  isConnected: boolean;
  marketActiveMode: 'LIVE' | 'REPLAY';
  
  // Underlier and Option Chain Calculations
  spotPrice: number;
  prevSpotPrice: number;
  atmStrike: number;
  optionChain: OptionChainRow[];
  
  // Interactive Parameters
  lotSize: number; // custom slot multiplier (usually 50 for Nifty)
  lotMultiplier: number; // how many lots (1, 2, 5, 10, etc.)
  orderType: 'MARKET' | 'LIMIT' | 'SL';
  limitPrice: number;
  slTriggerPrice: number;
  
  // Orders & Capital Store
  orders: Order[];
  positions: Position[];
  freeMargin: number;
  usedMargin: number;
  totalPnL: number;
  tradeCount: number;
  
  // Upstox integration state
  upstoxToken: string;
  isUpstoxConnected: boolean;
  isUpstoxLiveSynced: boolean;
  upstoxProfile: UpstoxProfile | null;
  upstoxMargin: UpstoxMargin | null;
  upstoxErrorMessage: string | null;
  
  // Python backend health
  backendStatus: 'unknown' | 'ok' | 'error';
  backendMode: string;
  backendError: string | null;
  
  // Analytics and Logs
  marketSignals: MarketSignal[];
  pcrValues: { timestamp: number; spot: number; pcr: number }[];
  hoveredTime: number | null; // sync crosshairs across pane layout

  // Simulated DuckDB Layer
  // asset_candles_10s tracks [timestamp, symbol, open, high, low, close, volume, open_interest]
  duckdbCandles: {
    [symbol: string]: Candlestick[];
  };
  sqlQuery: string;
  sqlConsoleResult: { columns: string[]; rows: any[][] } | null;
  sqlConsoleError: string | null;

  // Replay Specific Controls
  replayPlaying: boolean;
  replaySpeed: 1 | 2 | 5 | 10;
  replayIndex: number;
  replayMaxIndex: number;
  
  // Actions
  setConnection: (status: boolean) => void;
  setMode: (mode: 'LIVE' | 'REPLAY') => Promise<void>;
  setLotMultiplier: (mult: number) => void;
  setOrderType: (type: 'MARKET' | 'LIMIT' | 'SL') => void;
  setLimitPrice: (price: number) => void;
  setSLTriggerPrice: (price: number) => void;
  setHoveredTime: (time: number | null) => void;
  
  // Upstox API actions
  setUpstoxToken: (token: string) => void;
  connectUpstox: (token: string) => Promise<boolean>;
  connectUpstoxServerEnv: () => Promise<boolean>;
  disconnectUpstox: () => void;
  setUpstoxLiveSync: (sync: boolean) => void;
  fetchUpstoxProfile: () => Promise<void>;
  fetchUpstoxMargin: () => Promise<void>;
  fetchUpstoxPositions: () => Promise<void>;
  fetchUpstoxOptionChain: () => Promise<void>;
  pollUpstoxLiveTicks: () => Promise<void>;
  
  // Order Actions
  placeOrder: (symbol: string, strike: number, optionType: 'CE' | 'PE', action: 'BUY' | 'SELL', directPrice?: number) => void;
  exitAllPositions: () => void;
  exitSinglePosition: (symbol: string) => void;
  updateTrailingSL: (symbol: string, value: number) => void;
  
// Feed Actions
  fetchBackendHealth: () => Promise<void>;
  tickLiveFeed: (newSpot: number) => void;
  initHistoricalData: () => Promise<void>;
  runSqlQuery: (queryStr: string) => void;
  
  // Replay Loop Actions
  toggleReplayPlay: () => void;
  setReplaySpeed: (speed: 1 | 2 | 5 | 10) => void;
  stepReplayForward: () => void;
  resetReplayHead: () => void;
}

// Initial strike configuration
const STRIKE_INTERVAL = 50;

// Helper to parse Upstox candle format
function parseUpstoxCandles(upstoxCandles: any[]): Candlestick[] {
  if (!Array.isArray(upstoxCandles)) return [];
  const parsed = upstoxCandles.map((c: any) => {
    const t = typeof c[0] === 'string' ? Date.parse(c[0]) : Number(c[0]);
    return {
      time: t,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]) || 0,
      oi: Number(c[6]) || 0
    };
  });
  parsed.sort((a, b) => a.time - b.time);
  return parsed;
}

async function fetchCandlesForInstrument(token: string, instrumentKey: string): Promise<Candlestick[]> {
  try {
    // 0. Try DuckDB market data endpoint first (our 10s candles)
    try {
      const duckdbRes = await fetch(`/api/market-data/ohlcv/${encodeURIComponent(instrumentKey)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (duckdbRes.ok) {
        const duckResult = await duckdbRes.json();
        if (duckResult.status === 'success' && Array.isArray(duckResult.candles)) {
          return duckResult.candles.map((c: any) => ({
            time: new Date(c.time).getTime(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0,
            oi: c.oi || 0
          }));
        }
      }
    } catch (duckErr) {
      console.warn(`DuckDB fallback failed for ${instrumentKey}:`, duckErr);
    }

    const dTo = new Date();
    const dFrom = new Date();
    dFrom.setDate(dFrom.getDate() - 5); // 5 days back to ensure weekend/holiday coverage

    const formatDate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const toDateStr = formatDate(dTo);
    const fromDateStr = formatDate(dFrom);

    let histCandles: Candlestick[] = [];
    let intraCandles: Candlestick[] = [];

    // 1. Fetch historical candles (fills chart starting point)
    try {
      const histRes = await fetch(`/api/upstox/historical-candle/${encodeURIComponent(instrumentKey)}/1minute/${toDateStr}/${fromDateStr}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (histRes.ok) {
        const contentType = histRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await histRes.json();
          if (result.status === 'success' && result.data && Array.isArray(result.data.candles)) {
            histCandles = parseUpstoxCandles(result.data.candles);
          }
        } else {
          console.warn(`Non-JSON response received for historical candles of ${instrumentKey}`);
        }
      }
    } catch (err) {
      console.warn(`Error pulling history for ${instrumentKey}:`, err);
    }

    // 2. Fetch intraday candles (fills today's gap till now)
    try {
      const intraRes = await fetch(`/api/upstox/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/1minute`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (intraRes.ok) {
        const contentType = intraRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await intraRes.json();
          if (result.status === 'success' && result.data && Array.isArray(result.data.candles)) {
            intraCandles = parseUpstoxCandles(result.data.candles);
          }
        } else {
          console.warn(`Non-JSON response received for intraday candles of ${instrumentKey}`);
        }
      }
    } catch (err) {
      console.warn(`Error pulling intraday for ${instrumentKey}:`, err);
    }

    // 3. Merge, eliminate duplicates, and sort
    const merged = [...histCandles, ...intraCandles];
    const uniqueMap = new Map<number, Candlestick>();
    for (const c of merged) {
      uniqueMap.set(c.time, c);
    }
    const finalCandles = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
    return finalCandles;
  } catch (e) {
    console.error(`fetchCandlesForInstrument exception for ${instrumentKey}:`, e);
    return [];
  }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  // Defaults - initialized empty for LIVE mode, real data loaded from backend
  isConnected: true,
  marketActiveMode: 'LIVE',
  
  spotPrice: 0,
  prevSpotPrice: 0,
  atmStrike: 0,
  optionChain: [],
  
  lotSize: 50,
  lotMultiplier: 1,
  orderType: 'MARKET',
  limitPrice: 200,
  slTriggerPrice: 180,
  
  orders: [],
  positions: [],
  freeMargin: 100000, // INR 1 Lakh active leverage capital
  usedMargin: 0,
  totalPnL: 0,
  tradeCount: 0,
  
  // Upstox integration state defaults
  upstoxToken: '',
  isUpstoxConnected: false,
  isUpstoxLiveSynced: false,
  upstoxProfile: null,
  upstoxMargin: null,
  upstoxErrorMessage: null,

  backendStatus: 'unknown',
  backendMode: '',
  backendError: null,

  marketSignals: [],
  pcrValues: [],
  hoveredTime: null,

  duckdbCandles: {},
  sqlQuery: 'SELECT timestamp, symbol, close, volume, open_interest FROM asset_candles_10s WHERE symbol = \'NIFTY_SPOT\' ORDER BY timestamp DESC LIMIT 5;',
  sqlConsoleResult: null,
  sqlConsoleError: null,

  replayPlaying: false,
  replaySpeed: 1,
  replayIndex: 120, // Start somewhere into historical dataset
  replayMaxIndex: 150,

  setConnection: (status) => set({ isConnected: status }),
  
  setMode: async (mode) => {
    // If we toggle, toggle loop state and index
    if (mode === 'REPLAY') {
      await get().initHistoricalData();
      get().resetReplayHead();
    }
    set({ marketActiveMode: mode, replayPlaying: false });
  },
  
  setLotMultiplier: (mult) => set({ lotMultiplier: mult }),
  setOrderType: (type) => set({ orderType: type }),
  setLimitPrice: (price) => set({ limitPrice: price }),
  setSLTriggerPrice: (price) => set({ slTriggerPrice: price }),
  setHoveredTime: (time) => set({ hoveredTime: time }),

  // Upstox API actions
  setUpstoxToken: (token) => set({ upstoxToken: token }),
  
  connectUpstox: async (token) => {
    if (!token) return false;
    if (isServerEnvToken(token)) return get().connectUpstoxServerEnv();
    
    const lowerToken = token.trim().toLowerCase();
    if (lowerToken.includes('mock') || lowerToken.includes('sandbox') || lowerToken.includes('test') || token === '12345') {
      set({
        upstoxToken: token.trim(),
        isUpstoxConnected: true,
        upstoxProfile: null,
        upstoxMargin: null,
        upstoxErrorMessage: 'Mock token detected - real Upstox connection required for LIVE data',
        isUpstoxLiveSynced: false,
        freeMargin: 0,
        usedMargin: 0,
        positions: []
      });
      return true;
    }

    try {
      const res = await fetch('/api/upstox/user/profile', {
        headers: {
          'Authorization': `Bearer ${token.trim()}`
        }
      });
      
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        const snippet = text.substring(0, 150);
        let errMsg = `Upstox server returned invalid response format (Status ${res.status}).`;
        if (snippet.toLowerCase().includes("<!doctype html>") || res.status === 403 || res.status === 429 || res.status === 401) {
          errMsg = `Unauthorized or request blocked by Upstox (HTTP ${res.status}). Token may be expired or rate-limited.`;
        }
        set({ upstoxErrorMessage: errMsg, isUpstoxConnected: false });
        return false;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData?.errors?.[0]?.message || `HTTP ${res.status}: Token rejected by Upstox.`;
        set({ upstoxErrorMessage: errMsg, isUpstoxConnected: false });
        return false;
      }
      const result = await res.json();
      if (result.status === 'success' && result.data) {
        const uProfile = result.data;
        set({
          upstoxToken: token.trim(),
          isUpstoxConnected: true,
          isUpstoxLiveSynced: true,
          upstoxProfile: {
            email: uProfile.email || '',
            name: uProfile.name || '',
            member_id: uProfile.member_id || '',
            broker: uProfile.broker || 'UPSTOX',
            user_type: uProfile.user_type || 'RETAIL'
          },
          upstoxErrorMessage: null
        });
        
        // Trigger server-side WebSocket streamer connection manager
        await fetch('/api/upstox/connect-ws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.trim() })
        }).catch(err => console.warn("Failed to activate WS streamer:", err));

        await get().fetchUpstoxMargin();
        await get().fetchUpstoxPositions();
        return true;
      } else {
        set({ upstoxErrorMessage: 'Could not parse Upstox user profile response structure.', isUpstoxConnected: false });
        return false;
      }
    } catch (err: any) {
      set({ upstoxErrorMessage: `Network connection to gateway failed: ${err.message || err}`, isUpstoxConnected: false });
      return false;
    }
  },

  connectUpstoxServerEnv: async () => {
    try {
      const connectRes = await fetch('/api/upstox/connect-env', { method: 'POST' });
      const connectData = await connectRes.json().catch(() => ({}));
      if (!connectRes.ok || connectData.status !== 'success') {
        set({
          upstoxErrorMessage: connectData.message || 'Python backend could not connect with the configured Upstox token.',
          isUpstoxConnected: false
        });
        return false;
      }

      const profileRes = await fetch('/api/upstox/user/profile', {
        headers: { 'Authorization': `Bearer ${SERVER_ENV_TOKEN}` }
      });
      if (!profileRes.ok) {
        const errData = await profileRes.json().catch(() => ({}));
        set({ upstoxErrorMessage: errData.message || 'Server-side Upstox token rejected.', isUpstoxConnected: false });
        return false;
      }

      const profileData = await profileRes.json();
      const uProfile = profileData.data || {};
      set({
        upstoxToken: SERVER_ENV_TOKEN,
        isUpstoxConnected: true,
        isUpstoxLiveSynced: true,
        upstoxProfile: {
          email: uProfile.email || '',
          name: uProfile.name || '',
          member_id: uProfile.member_id || '',
          broker: uProfile.broker || 'UPSTOX',
          user_type: uProfile.user_type || 'RETAIL'
        },
        upstoxErrorMessage: null
      });

      await get().fetchUpstoxMargin();
      await get().fetchUpstoxPositions();
      return true;
    } catch (err: any) {
      set({ upstoxErrorMessage: `Python backend connection failed: ${err.message || err}`, isUpstoxConnected: false });
      return false;
    }
  },

  disconnectUpstox: () => {
    set({
      upstoxToken: '',
      isUpstoxConnected: false,
      isUpstoxLiveSynced: false,
      upstoxProfile: null,
      upstoxMargin: null,
      upstoxErrorMessage: null,
      freeMargin: 100000,
      usedMargin: 0,
      positions: []
    });
  },

  setUpstoxLiveSync: (sync) => {
    set({ isUpstoxLiveSynced: sync });
    if (sync) {
      get().fetchUpstoxMargin();
      get().fetchUpstoxPositions();
    }
  },

  fetchUpstoxProfile: async () => {
    const token = get().upstoxToken;
    if (!token || token.toLowerCase().includes('mock')) return;
    try {
      const res = await fetch('/api/upstox/user/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await res.json();
          if (result.status === 'success' && result.data) {
            const uProfile = result.data;
            set({
              upstoxProfile: {
                email: uProfile.email || '',
                name: uProfile.name || '',
                member_id: uProfile.member_id || '',
                broker: uProfile.broker || 'UPSTOX',
                user_type: uProfile.user_type || 'RETAIL'
              }
            });
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  fetchUpstoxMargin: async () => {
    const token = get().upstoxToken;
    if (!token) return;
    if (token.toLowerCase().includes('mock') || token.toLowerCase().includes('sandbox')) {
      return;
    }
    try {
      const res = await fetch('/api/upstox/user/get-margin', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await res.json();
          if (result.status === 'success' && result.data) {
            const equity = result.data.equity || {};
            const uMargin = {
              available_margin: equity.available_margin || 0,
              used_margin: equity.used_margin || 0,
              payin_amount: equity.payin_amount || 0
            };
            set({
              upstoxMargin: uMargin,
              ...(get().isUpstoxLiveSynced ? {
                freeMargin: uMargin.available_margin,
                usedMargin: uMargin.used_margin
              } : {})
            });
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  fetchUpstoxPositions: async () => {
    const token = get().upstoxToken;
    if (!token) return;
    if (token.toLowerCase().includes('mock') || token.toLowerCase().includes('sandbox')) {
      return;
    }
    try {
      const res = await fetch('/api/upstox/portfolio/positions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await res.json();
          if (result.status === 'success' && Array.isArray(result.data)) {
            const mappedPositions = result.data.map((p: any) => {
              const isPE = p.trading_symbol.toUpperCase().endsWith('PE');
              const isCE = p.trading_symbol.toUpperCase().endsWith('CE');
              const strikeMatch = p.trading_symbol.match(/\d+/g);
              const strike = strikeMatch ? parseInt(strikeMatch[strikeMatch.length - 1]) : 23500;
              return {
                symbol: p.trading_symbol,
                optionType: (isPE ? 'PE' : 'CE') as 'CE' | 'PE',
                strike: strike,
                avgCost: p.average_price || 0,
                quantity: p.quantity,
                ltp: p.last_price || 0,
                trailingSL: undefined,
              pnl: p.pnl || 0,
              entryTime: Date.now()
            };
          });
          set({
            ...(get().isUpstoxLiveSynced ? {
              positions: mappedPositions
            } : {})
          });
        }
      }
    }
    } catch (e) {
      console.error(e);
    }
  },

  fetchUpstoxOptionChain: async () => {
    const token = get().upstoxToken;
    if (!token) return;
    if (token.toLowerCase().includes('mock') || token.toLowerCase().includes('sandbox')) {
      return;
    }

    try {
      // 1. Fetch expiry dates directly from Upstox using instruments/search
      const todayStr = new Date().toISOString().split('T')[0];
      const searchParams = new URLSearchParams({ query: 'Nifty', expiry: 'current_month', records: '100', segments: 'FO' });
      let expiryDate = '';
      
      try {
        const searchRes = await fetch(`/api/upstox/instruments/search?${searchParams.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (searchRes.ok) {
          const result = await searchRes.json();
          if (result.status === 'success' && Array.isArray(result.data)) {
            const expiries = Array.from(new Set(result.data.map((c: any) => c.expiry)))
              .filter((exp: any) => typeof exp === 'string' && exp >= todayStr)
              .sort() as string[];
            if (expiries.length > 0) {
              expiryDate = expiries[0]; // Use the first (nearest) expiry from broker
            }
          }
        }
      } catch (searchErr) {
        console.warn("Could not fetch expiries from instruments/search:", searchErr);
      }
              const expiries = Array.from(new Set(result.data.map((c: any) => c.expiry)))
                .filter((exp: any) => typeof exp === 'string' && exp >= todayStr)
                .sort() as string[];
              if (expiries.length > 0) {
                expiryDate = expiries[0];
              }
            }
          } else {
            console.warn("Non-JSON Response received for contracts.");
          }
        }
      } catch (contractErr) {
        console.warn("Could not fetch option contracts, falling back to math expiry calculation:", contractErr);
      }

      // Calculate nearest Thursday if no expiry found online as high robustness fallback
      if (!expiryDate) {
        const d = new Date();
        const day = d.getDay();
        const diff = (4 - day + 7) % 7;
        d.setDate(d.getDate() + diff);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        expiryDate = `${yyyy}-${mm}-${dd}`;
      }

      // 2. Query actual Option Chain API
      const chainParams = new URLSearchParams({ instrument_key: 'NSE_INDEX|Nifty 50', expiry_date: expiryDate });
      const chainRes = await fetch(`/api/upstox/option/chain?${chainParams.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (chainRes.ok) {
        const contentType = chainRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const result = await chainRes.json();
          if (result.status === 'success' && Array.isArray(result.data)) {
          const rawChain = result.data;
          if (rawChain.length === 0) return;

          // Determine spot price from the first row of option chain
          const spotPrice = rawChain[0]?.underlying_spot_price || get().spotPrice;
          const prevSpot = get().spotPrice;
          const atm = Math.round(spotPrice / 50) * 50;

          // Process and sort actual chain
          rawChain.sort((a: any, b: any) => a.strike_price - b.strike_price);

          // Find closest ATM index
          let minDistance = Infinity;
          let atmIdx = 0;
          for (let i = 0; i < rawChain.length; i++) {
            const d = Math.abs(rawChain[i].strike_price - spotPrice);
            if (d < minDistance) {
              minDistance = d;
              atmIdx = i;
            }
          }

          // Slice to ATM ± 7 strikes to fit viewport beautifully
          const startIdx = Math.max(0, atmIdx - 7);
          const endIdx = Math.min(rawChain.length, atmIdx + 8);
          const filteredRows = rawChain.slice(startIdx, endIdx);

          const newChain: OptionChainRow[] = filteredRows.map((node: any) => {
            const strike = node.strike_price;
            
            const callLtp = node.call_options?.market_data?.ltp || 0;
            const oldRow = get().optionChain.find(r => r.strike === strike);
            const callPrevLtp = oldRow?.callLtp || callLtp;

            const putLtp = node.put_options?.market_data?.ltp || 0;
            const putPrevLtp = oldRow?.putLtp || putLtp;

            return {
              strike,
              callLtp,
              callPrevLtp,
              callOi: node.call_options?.market_data?.oi || 0,
              callOiChange: Number((node.call_options?.market_data?.oi_change || 0).toFixed(0)),
              callSymbol: node.call_options?.trading_symbol || `NIFTY_${strike}_CE`,
              callSymbolName: node.call_options?.instrument_key || '',
              putLtp,
              putPrevLtp,
              putOi: node.put_options?.market_data?.oi || 0,
              putOiChange: Number((node.put_options?.market_data?.oi_change || 0).toFixed(0)),
              putSymbol: node.put_options?.trading_symbol || `NIFTY_${strike}_PE`,
              putSymbolName: node.put_options?.instrument_key || ''
            };
          });

          // Generate custom signal entries if trend direction shifts
          const now = Date.now();
          const nextSignals = [...get().marketSignals];
          const hasBigChange = Math.abs(spotPrice - prevSpot) > 0.01;
          if (hasBigChange) {
            const interpretation = (spotPrice >= prevSpot) ? 'LONG BUILDUP' : 'SHORT BUILDUP';
            nextSignals.push({
              timestamp: now,
              symbol: 'NIFTY_SPOT',
              price: spotPrice,
              changeInPrice: Number((spotPrice - prevSpot).toFixed(2)),
              changeInOI: 12500,
              interpretation
            });
            if (nextSignals.length > 30) nextSignals.shift();
          }

          // Compute Put-Call-Ratio
          let callOISum = 0;
          let putOISum = 0;
          newChain.forEach(row => {
            callOISum += row.callOi;
            putOISum += row.putOi;
          });
          const pcr = callOISum > 0 ? Number((putOISum / callOISum).toFixed(3)) : 1.0;
          const nextPcrValues = [...get().pcrValues, { timestamp: now, spot: spotPrice, pcr }];
          if (nextPcrValues.length > 100) nextPcrValues.shift();

// Real-time Upstox Candle updates for Spot index and ATM options
           const updatedDuckdb = { ...get().duckdbCandles };
           const updateSymbolCandle = (symbol: string, currentPrice: number, volume: number, oi: number, type: 'SPOT' | 'CE' | 'PE', strike: number) => {
             let arr = updatedDuckdb[symbol] ? [...updatedDuckdb[symbol]] : [];
             if (arr.length === 0) {
               // No fallback - only real data from backend
               return;
             }
             if (arr.length === 0) return;
             const last = { ...arr[arr.length - 1] };
             const timeDiff = now - last.time;

            if (timeDiff >= 10000) {
              const newBar: Candlestick = {
                time: last.time + 10000,
                open: last.close,
                high: currentPrice,
                low: currentPrice,
                close: currentPrice,
                volume,
                oi
              };
              arr.push(newBar);
              if (arr.length > 300) arr.shift();
            } else {
              last.high = Math.max(last.high, currentPrice);
              last.low = Math.min(last.low, currentPrice);
              last.close = currentPrice;
              last.volume += Math.round(volume / 5);
              last.oi = oi;
              arr[arr.length - 1] = last;
            }
            updatedDuckdb[symbol] = arr;
          };

          // Find ATM node inside rawChain to obtain accurate LTP/OI values
          const atmNode = rawChain.find((node: any) => node.strike_price === atm);
          const atmCallLtp = atmNode?.call_options?.market_data?.ltp;
          const atmCallOi = atmNode?.call_options?.market_data?.oi || 0;
          const atmPutLtp = atmNode?.put_options?.market_data?.ltp;
          const atmPutOi = atmNode?.put_options?.market_data?.oi || 0;

          const atmCallKey = atmNode?.call_options?.instrument_key;
          const atmPutKey = atmNode?.put_options?.instrument_key;

          // Register dynamic websocket subscriptions for ATM options on our server
          if (atmCallKey || atmPutKey) {
            const keysToSubscribe = [];
            if (atmCallKey) keysToSubscribe.push(atmCallKey);
            if (atmPutKey) keysToSubscribe.push(atmPutKey);
            fetch('/api/upstox/subscribe-ws', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys: keysToSubscribe })
            }).catch(subWsErr => console.warn("Failed dynamic WS option subscription registry:", subWsErr));
          }

// Fetch actual historical/intraday candle data to fill chart gaps and prevent empty candles
           const lastAtm = get().atmStrike;
           const isFirstSyncOrDiscontinuous = lastAtm === 0 || lastAtm !== atm || !get().isUpstoxLiveSynced || Math.abs(spotPrice - get().spotPrice) > 150;
           
           if (isFirstSyncOrDiscontinuous) {
             console.log("Live Sync triggered or ATM strike changed. Requesting actual candlestick histories for Spot, CE, PE from Upstox.");
             
             // 1. Fetch real spot candles
             const spotCandlesReal = await fetchCandlesForInstrument(token, 'NSE_INDEX|Nifty 50');
             if (spotCandlesReal.length > 0) {
               updatedDuckdb['NIFTY_SPOT'] = spotCandlesReal;
             }
             
             // 2. Fetch real CE options candles
             if (atmCallKey) {
               const ceCandlesReal = await fetchCandlesForInstrument(token, atmCallKey);
               if (ceCandlesReal.length > 0) {
                 updatedDuckdb[`NIFTY_${atm}_CE`] = ceCandlesReal;
               }
             }
             
             // 3. Fetch real PE options candles
             if (atmPutKey) {
               const peCandlesReal = await fetchCandlesForInstrument(token, atmPutKey);
               if (peCandlesReal.length > 0) {
                 updatedDuckdb[`NIFTY_${atm}_PE`] = peCandlesReal;
               }
             }
           }

          updateSymbolCandle('NIFTY_SPOT', spotPrice, Math.round(20000 + Math.random() * 10000), 0, 'SPOT', 0);
          updateSymbolCandle(`NIFTY_${atm}_CE`, atmCallLtp, Math.round(5000 + Math.random() * 10000), atmCallOi, 'CE', atm);
          updateSymbolCandle(`NIFTY_${atm}_PE`, atmPutLtp, Math.round(5000 + Math.random() * 10000), atmPutOi, 'PE', atm);

          // Sync local positions P&L with real-time Option Chain LTPs
const updatedLocalPositions = get().positions.map(p => {
             const row = newChain.find(r => r.strike === p.strike);
             const isCE = p.optionType === 'CE';
             const optLtp = row ? (isCE ? row.callLtp : row.putLtp) : undefined;
             const profitPoints = optLtp !== undefined ? optLtp - p.avgCost : 0;
             const pnlSum = optLtp !== undefined ? profitPoints * p.quantity * get().lotSize : 0;
             return {
               ...p,
               ltp: optLtp !== undefined ? optLtp : p.ltp,
               pnl: Number(pnlSum.toFixed(2))
             };
           });

          const totalPnL = updatedLocalPositions.reduce((acc, curr) => acc + curr.pnl, 0);

          set({
            spotPrice,
            prevSpotPrice: prevSpot,
            atmStrike: atm,
            optionChain: newChain,
            marketSignals: nextSignals,
            pcrValues: nextPcrValues,
            positions: updatedLocalPositions,
            duckdbCandles: updatedDuckdb,
            totalPnL: Number(totalPnL.toFixed(2))
          });
        }
      }
    }
    } catch (e) {
      console.error("Upstox live option chain sync exception:", e);
    }
  },

  pollUpstoxLiveTicks: async () => {
    const token = get().upstoxToken;
    if (!token || token.toLowerCase().includes('mock')) return;
    try {
      const res = await fetch('/api/upstox-feed');
      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          if (json.status === 'success' && json.data) {
          const feed = json.data;
          
          if (feed.wsError) {
            set({ upstoxErrorMessage: `WebSocket Connection Blocked: ${feed.wsError}` });
          } else if (feed.wsStatus === 'connecting') {
            set({ upstoxErrorMessage: 'Establishing backend WebSocket stream feed...' });
          } else if (feed.wsStatus === 'connected' && get().upstoxErrorMessage?.includes('WebSocket')) {
            set({ upstoxErrorMessage: null });
          }
          
          if (feed.spotPrice > 0) {
            const spotPrice = feed.spotPrice;
            const prevSpot = get().spotPrice;
            const atm = Math.round(spotPrice / 50) * 50;
            const now = Date.now();
            
            const lastAtm = get().atmStrike;
            const isFirstSyncOrDiscontinuous = lastAtm === 0 || lastAtm !== atm || !get().isUpstoxLiveSynced || Math.abs(spotPrice - prevSpot) > 150;
            
            const updatedDuckdb = { ...get().duckdbCandles };
            
            if (isFirstSyncOrDiscontinuous) {
              console.log(`ATM Strike changed or first live sync. Downloading historical candles for Nifty spot and ATM options...`);
              const realSpotCandles = await fetchCandlesForInstrument(token, 'NSE_INDEX|Nifty 50');
              if (realSpotCandles.length > 0) {
                updatedDuckdb['NIFTY_SPOT'] = realSpotCandles;
              }
              
              const atmRow = get().optionChain.find(r => r.strike === atm);
              if (atmRow) {
                if (atmRow.callSymbolName) {
                  const ceCandles = await fetchCandlesForInstrument(token, atmRow.callSymbolName);
                  if (ceCandles.length > 0) updatedDuckdb[`NIFTY_${atm}_CE`] = ceCandles;
                }
                if (atmRow.putSymbolName) {
                  const peCandles = await fetchCandlesForInstrument(token, atmRow.putSymbolName);
                  if (peCandles.length > 0) updatedDuckdb[`NIFTY_${atm}_PE`] = peCandles;
                }
              }
            }
            
            const updateSymbolCandle = (symbol: string, currentPrice: number, volume: number, oi: number, type: 'SPOT' | 'CE' | 'PE', strike: number) => {
              let arr = updatedDuckdb[symbol] ? [...updatedDuckdb[symbol]] : [];
              if (arr.length === 0) {
                // No fallback - only use real data
                return;
              }
              if (arr.length === 0) return;
              const last = { ...arr[arr.length - 1] };
              const timeDiff = now - last.time;

              if (timeDiff >= 60000) {
                const newBar: Candlestick = {
                  time: last.time + 60000,
                  open: last.close,
                  high: currentPrice,
                  low: currentPrice,
                  close: currentPrice,
                  volume,
                  oi
                };
                arr.push(newBar);
                if (arr.length > 300) arr.shift();
              } else {
                last.high = Math.max(last.high, currentPrice);
                last.low = Math.min(last.low, currentPrice);
                last.close = currentPrice;
                last.volume += Math.round(volume / 50);
                last.oi = oi;
                arr[arr.length - 1] = last;
              }
              updatedDuckdb[symbol] = arr;
            };

            const atmRow = get().optionChain.find(r => r.strike === atm);
            const atmCallLtp = atmRow?.callSymbolName && feed.ticks?.[atmRow.callSymbolName]?.ltp ? feed.ticks[atmRow.callSymbolName].ltp : (atmRow?.callLtp);
            const atmCallOi = atmRow?.callSymbolName && feed.ticks?.[atmRow.callSymbolName]?.oi ? feed.ticks[atmRow.callSymbolName].oi : (atmRow?.callOi);

            const atmPutLtp = atmRow?.putSymbolName && feed.ticks?.[atmRow.putSymbolName]?.ltp ? feed.ticks[atmRow.putSymbolName].ltp : (atmRow?.putLtp);
            const atmPutOi = atmRow?.putSymbolName && feed.ticks?.[atmRow.putSymbolName]?.oi ? feed.ticks[atmRow.putSymbolName].oi : (atmRow?.putOi);

            updateSymbolCandle('NIFTY_SPOT', spotPrice, 50000, 0, 'SPOT', 0);
            updateSymbolCandle(`NIFTY_${atm}_CE`, atmCallLtp, 10000, atmCallOi, 'CE', atm);
            updateSymbolCandle(`NIFTY_${atm}_PE`, atmPutLtp, 10000, atmPutOi, 'PE', atm);

            const nextChain = get().optionChain.map(row => {
              let updatedRow = { ...row };
              if (row.callSymbolName && feed.ticks?.[row.callSymbolName]?.ltp) {
                updatedRow.callPrevLtp = row.callLtp;
                updatedRow.callLtp = feed.ticks[row.callSymbolName].ltp;
                updatedRow.callOi = feed.ticks[row.callSymbolName].oi || row.callOi;
              }
              if (row.putSymbolName && feed.ticks?.[row.putSymbolName]?.ltp) {
                updatedRow.putPrevLtp = row.putLtp;
                updatedRow.putLtp = feed.ticks[row.putSymbolName].ltp;
                updatedRow.putOi = feed.ticks[row.putSymbolName].oi || row.putOi;
              }
              return updatedRow;
            });

            const updatedLocalPositions = get().positions.map(p => {
              const row = nextChain.find(r => r.strike === p.strike);
              const isCE = p.optionType === 'CE';
              const optLtp = row ? (isCE ? row.callLtp : row.putLtp) : undefined;
              const profitPoints = optLtp !== undefined ? optLtp - p.avgCost : 0;
              const pnlSum = profitPoints * p.quantity * get().lotSize;
              return {
                ...p,
                ltp: optLtp !== undefined ? optLtp : p.ltp,
                pnl: Number(pnlSum.toFixed(2))
              };
            });

            const totalPnL = updatedLocalPositions.reduce((acc, curr) => acc + curr.pnl, 0);

            set({
              spotPrice,
              prevSpotPrice: prevSpot,
              atmStrike: atm,
              optionChain: nextChain,
              positions: updatedLocalPositions,
              duckdbCandles: updatedDuckdb,
              totalPnL: Number(totalPnL.toFixed(2))
            });
          }
        }
      }
    }
    } catch (e) {
      console.error("Error polling fast ticks from server backend:", e);
    }
  },

  fetchBackendHealth: async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ backendStatus: 'ok', backendMode: data.backend || data.mode || '', backendError: null });
    } catch (err: any) {
      set({ backendStatus: 'error', backendMode: '', backendError: err.message || String(err) });
    }
  },

// Initialize beautiful historical metrics datasets - REPLAY mode loads real data from backend
   initHistoricalData: async () => {
     const initialDuckdb: { [symbol: string]: Candlestick[] } = {};
     const optionChain: OptionChainRow[] = [];

     // Try to load real NIFTY SPOT candles from DuckDB
     try {
       const spotRes = await fetch('/api/market-data/ohlcv/NSE_INDEX|Nifty 50');
       if (spotRes.ok) {
         const spotResult = await spotRes.json();
         if (spotResult.status === 'success' && Array.isArray(spotResult.candles)) {
           initialDuckdb['NIFTY_SPOT'] = spotResult.candles.map((c: any) => ({
             time: new Date(c.time).getTime(),
             open: c.open,
             high: c.high,
             low: c.low,
             close: c.close,
             volume: c.volume || 0,
             oi: c.oi || 0
           }));
         }
       }
     } catch (e) {
       console.warn('Failed to load NIFTY SPOT candles for REPLAY:', e);
     }

     // Try to load option chain from DuckDB for REPLAY mode
     try {
       const chainRes = await fetch('/api/market-data/option-chain');
       if (chainRes.ok) {
         const chainResult = await chainRes.json();
         if (chainResult.status === 'success' && Array.isArray(chainResult.data)) {
           chainResult.data.forEach((node: any) => {
             if (node.strike_price) {
               optionChain.push({
                 strike: node.strike_price,
                 callLtp: node.call_options?.market_data?.ltp || 0,
                 callPrevLtp: node.call_options?.market_data?.ltp || 0,
                 callOi: node.call_options?.market_data?.oi || 0,
                 callOiChange: 0,
                 callSymbol: node.call_options?.trading_symbol || `NIFTY_${node.strike_price}_CE`,
                 callSymbolName: node.call_options?.instrument_key || '',
                 putLtp: node.put_options?.market_data?.ltp || 0,
                 putPrevLtp: node.put_options?.market_data?.ltp || 0,
                 putOi: node.put_options?.market_data?.oi || 0,
                 putOiChange: 0,
                 putSymbol: node.put_options?.trading_symbol || `NIFTY_${node.strike_price}_PE`,
                 putSymbolName: node.put_options?.instrument_key || ''
               });
             }
           });
           optionChain.sort((a, b) => a.strike - b.strike);
         }
       }
     } catch (e) {
       console.warn('Failed to load option chain for REPLAY:', e);
     }

     set({
       duckdbCandles: initialDuckdb,
       optionChain,
       pcrValues: [],
       replayMaxIndex: (initialDuckdb['NIFTY_SPOT']?.length || 0) - 1
     });

     // run default successful query on startup
     get().runSqlQuery(get().sqlQuery);
   },

  // Simulated DuckDB Relational Select SQL Engine in workers/main thread sandbox
  runSqlQuery: (queryStr: string) => {
    set({ sqlQuery: queryStr });
    const cleanQuery = queryStr.trim().replace(/\s+/g, ' ').toLowerCase();
    
    if (!cleanQuery.startsWith('select')) {
      set({
        sqlConsoleError: 'SQL Error: Only SELECT queries are permitted on asset_candles_10s database.',
        sqlConsoleResult: null
      });
      return;
    }

    try {
      const state = get();
      // Compile dynamic table database
      // Schema: timestamp | symbol | open | high | low | close | volume | open_interest
      const dataset: any[] = [];
      Object.keys(state.duckdbCandles).forEach(symbol => {
        const candles = state.duckdbCandles[symbol];
        candles.forEach(c => {
          dataset.push({
            timestamp: new Date(c.time).toISOString().replace('T', ' ').slice(0, 19),
            symbol,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            open_interest: c.oi
          });
        });
      });

      // Simple matching engine
      // Parse Limit
      const limitMatch = cleanQuery.match(/limit\s+(\d+)/);
      const limit = limitMatch ? parseInt(limitMatch[1]) : 100;

      // Filter by symbol
      let filtered = dataset;
      const symbolMatch = cleanQuery.match(/symbol\s*=\s*'([^']+)'/) || cleanQuery.match(/symbol\s*=\s*"([^"]+)"/);
      if (symbolMatch) {
        const targetSym = symbolMatch[1].toUpperCase();
        filtered = filtered.filter(row => row.symbol.toUpperCase() === targetSym);
      }

      // Order by timestamp DESC/ASC
      filtered.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (cleanQuery.includes('order by desc') || cleanQuery.includes('desc')) {
          return timeB - timeA;
        } else {
          return timeA - timeB;
        }
      });

      // Slice limits
      const slicedResult = filtered.slice(0, limit);

      // Map dynamic selected columns
      let selectClause = cleanQuery.split('from')[0].replace('select', '').trim();
      let columnsToPick: string[] = [];

      if (selectClause === '*') {
        columnsToPick = ['timestamp', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'open_interest'];
      } else {
        columnsToPick = selectClause.split(',').map(c => c.trim().toLowerCase());
      }

      const finalRows = slicedResult.map(row => {
        return columnsToPick.map(col => row[col] !== undefined ? row[col] : null);
      });

      set({
        sqlConsoleResult: {
          columns: columnsToPick.map(c => c.toUpperCase()),
          rows: finalRows
        },
        sqlConsoleError: null
      });

    } catch (err: any) {
      set({
        sqlConsoleError: `SQL Parsing Exception: ${err.message || err}`,
        sqlConsoleResult: null
      });
    }
  },

// Simulated ticks updates - REPLAY mode uses DB data only, no mock generation
   tickLiveFeed: (newSpot: number) => {
     const state = get();
     if (!state.isConnected) return;
     if (state.marketActiveMode !== 'REPLAY') return;

     const prevSpot = state.spotPrice;
     
     // No mock data generation - only use real data from DB
     // Exit early if no option chain data exists
     if (state.optionChain.length === 0) return;

     const atm = state.atmStrike || Math.round(newSpot / STRIKE_INTERVAL) * STRIKE_INTERVAL;

     const now = Date.now();

     // Update active Positions margins/PnL dynamically from existing chain
     const activePositions = state.positions.map(p => {
       const row = state.optionChain.find(r => r.strike === p.strike);
       if (!row) return p;
       const isCE = p.optionType === 'CE';
       const optLtp = isCE ? row.callLtp : row.putLtp;
       if (optLtp === undefined) return p;
       const profitPoints = optLtp - p.avgCost;
       const pnlSum = profitPoints * p.quantity * state.lotSize;

       return { ...p, ltp: optLtp, pnl: Number(pnlSum.toFixed(2)) };
     });

     const totalPnL = activePositions.reduce((acc, curr) => acc + curr.pnl, 0);

     set({
       spotPrice: newSpot,
       prevSpotPrice: prevSpot,
       positions: activePositions,
       totalPnL: Number(totalPnL.toFixed(2))
     });
   },

  // Interactive Execution Dock and Option Chain quick buttons Place Order Rules
  placeOrder: (symbol, strike, optionType, action, directPrice) => {
    const state = get();
    if (!state.isConnected) return;

    // Premium pricing calculation
    let currentPrem = directPrice;
    if (!currentPrem) {
      const matchedRow = state.optionChain.find(r => r.strike === strike);
      if (matchedRow) {
        currentPrem = optionType === 'CE' ? matchedRow.callLtp : matchedRow.putLtp;
      }
    }
    if (!currentPrem || currentPrem <= 0) {
      // No mock fallback - only real data allowed
      return;
    }
    const premiumTotal = currentPrem * state.lotSize * state.lotMultiplier;

    if (action === 'BUY' && state.freeMargin < premiumTotal) {
      // Reject Insufficient Funds Order Log
      const orderId = `ORD_${Math.floor(Math.random() * 90000 + 10000)}`;
      const rejectedOrder: Order = {
        id: orderId,
        symbol,
        strike,
        optionType,
        action,
        price: currentPrem,
        quantity: state.lotMultiplier,
        timestamp: Date.now(),
        status: 'CANCELLED'
      };
      set({ orders: [rejectedOrder, ...state.orders] });
      return;
    }

    // Ledger insert
    const orderId = `ORD_${Math.floor(Math.random() * 90000 + 10000)}`;
    const newOrder: Order = {
      id: orderId,
      symbol,
      strike,
      optionType,
      action,
      price: currentPrem,
      quantity: state.lotMultiplier,
      timestamp: Date.now(),
      status: 'FILLED'
    };

    // Position updates ledger
    let nextPositions = [...state.positions];
    const matchIdx = nextPositions.findIndex(p => p.symbol === symbol);

    if (action === 'BUY') {
      if (matchIdx >= 0) {
        // Avg up existing sizes
        const existing = nextPositions[matchIdx];
        const newTotalQty = existing.quantity + state.lotMultiplier;
        const totalCost = (existing.avgCost * existing.quantity) + (currentPrem * state.lotMultiplier);
        existing.avgCost = Number((totalCost / newTotalQty).toFixed(2));
        existing.quantity = newTotalQty;
        existing.pnl = 0;
      } else {
        // Standard initial position entry
        nextPositions.push({
          symbol,
          optionType,
          strike,
          avgCost: currentPrem,
          quantity: state.lotMultiplier,
          ltp: currentPrem,
          pnl: 0,
          entryTime: Date.now()
        });
      }
      // Deduct capital
      set({
        orders: [newOrder, ...state.orders],
        positions: nextPositions,
        freeMargin: state.freeMargin - premiumTotal,
        usedMargin: state.usedMargin + premiumTotal,
        tradeCount: state.tradeCount + 1
      });
    } else {
      // Sell Orders / Exit Options Position
      if (matchIdx >= 0) {
        const existing = nextPositions[matchIdx];
        const qtyDiff = existing.quantity - state.lotMultiplier;
        if (qtyDiff <= 0) {
          // Complete position closing
          nextPositions = nextPositions.filter(p => p.symbol !== symbol);
        } else {
          existing.quantity = qtyDiff;
        }
        
        // Return values and calculate realized margin factors
        set({
          orders: [newOrder, ...state.orders],
          positions: nextPositions,
          freeMargin: state.freeMargin + premiumTotal,
          usedMargin: Math.max(0, state.usedMargin - (existing.avgCost * state.lotMultiplier * state.lotSize)),
          tradeCount: state.tradeCount + 1
        });
      } else {
        // Direct naked short simulation restriction (only allowing exits for simplification)
        newOrder.status = 'CANCELLED';
        set({ orders: [newOrder, ...state.orders] });
      }
    }
  },

  exitAllPositions: () => {
    const state = get();
    if (state.positions.length === 0) return;

    const auditOrders: Order[] = [];
    let refundedCapitalSum = 0;

    state.positions.forEach(p => {
      const exitLtp = p.ltp;
      const rawMarginRefund = exitLtp * p.quantity * state.lotSize;
      refundedCapitalSum += rawMarginRefund;

      auditOrders.push({
        id: `ORD_${Math.floor(Math.random() * 90000 + 10000)}`,
        symbol: p.symbol,
        strike: p.strike,
        optionType: p.optionType,
        action: 'SELL',
        price: exitLtp,
        quantity: p.quantity,
        timestamp: Date.now(),
        status: 'FILLED'
      });
    });

    set({
      positions: [],
      orders: [...auditOrders, ...state.orders],
      freeMargin: state.freeMargin + refundedCapitalSum,
      usedMargin: 0
    });
  },

  exitSinglePosition: (symbol) => {
    const state = get();
    const pos = state.positions.find(p => p.symbol === symbol);
    if (!pos) return;
    
    get().placeOrder(pos.symbol, pos.strike, pos.optionType, 'SELL', pos.ltp);
  },

  updateTrailingSL: (symbol, value) => {
    set(state => ({
      positions: state.positions.map(p => p.symbol === symbol ? { ...p, trailingSL: value } : p)
    }));
  },

  // Replay Head controls
  toggleReplayPlay: () => {
    set(state => ({ replayPlaying: !state.replayPlaying }));
  },

  setReplaySpeed: (speed) => {
    set({ replaySpeed: speed });
  },

  stepReplayForward: () => {
    const state = get();
    const nextIdx = state.replayIndex + 1;
    if (nextIdx > state.replayMaxIndex) {
      set({ replayPlaying: false });
      return;
    }

    // Capture simulated database candle frames
    const spotCandle = state.duckdbCandles['NIFTY_SPOT']?.[nextIdx];
    if (!spotCandle) return;

    set({ replayIndex: nextIdx });
    get().tickLiveFeed(spotCandle.close);
  },

  resetReplayHead: () => {
    set({
      replayIndex: 50,
      replayPlaying: false
    });
    // Set Feed dynamically to starting tick value
    const initialHist = get().duckdbCandles['NIFTY_SPOT']?.[50];
    if (initialHist) {
      get().tickLiveFeed(initialHist.close);
    }
  }
}));
