export interface Candlestick {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

export interface Instrument {
  symbol: string;
  strike: number;
  type: 'CE' | 'PE' | 'SPOT';
  ltp: number;
  prevLtp: number;
  oi: number;
  oiChange: number;
  candles: Candlestick[];
}

export interface Order {
  id: string;
  symbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  timestamp: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED';
}

export interface Position {
  symbol: string;
  optionType: 'CE' | 'PE';
  strike: number;
  avgCost: number;
  quantity: number;
  ltp: number;
  trailingSL?: number;
  pnl: number;
  entryTime: number;
}

export interface MarketSignal {
  timestamp: number; // ms
  symbol: string;
  price: number;
  changeInPrice: number;
  changeInOI: number;
  interpretation: 'LONG BUILDUP' | 'SHORT BUILDUP' | 'SHORT COVERING' | 'LONG UNWINDING' | 'NEUTRAL';
}

export interface OptionChainRow {
  strike: number;
  callLtp: number;
  callPrevLtp: number;
  callOi: number;
  callOiChange: number;
  callSymbol: string;
  callSymbolName?: string; // e.g. NSE_FO|54320
  putLtp: number;
  putPrevLtp: number;
  putOi: number;
  putOiChange: number;
  putSymbol: string;
  putSymbolName?: string; // e.g. NSE_FO|54321
}

export interface UpstoxProfile {
  email: string;
  name: string;
  member_id: string;
  broker?: string;
  user_type?: string;
}

export interface UpstoxMargin {
  used_margin: number;
  payin_amount: number;
  available_margin: number;
}

