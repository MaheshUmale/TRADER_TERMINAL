import React, { useRef, useEffect, useState } from 'react';
import { useTerminalStore } from '../store';
import { Candlestick } from '../types';
import { ChartCandlestickCanvas } from './ChartCandlestickCanvas';

export function TripleChartGrid() {
  const store = useTerminalStore();
  const spotCandles = store.duckdbCandles['NIFTY_SPOT'] || [];
  
  // Dynamic Option candles are fetched on demand from the current options keys
  const activeCE = `NIFTY_${store.atmStrike}_CE`;
  const activePE = `NIFTY_${store.atmStrike}_PE`;
  
  const ceCandles = store.duckdbCandles[activeCE] || [];
  const peCandles = store.duckdbCandles[activePE] || [];

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col gap-2 p-3 bg-white rounded-lg border border-zinc-200 shadow-xs">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2 px-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-850 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          REAL-TIME OPTION DESK TRIPLE GRID
        </h3>
        <div className="text-[10px] font-mono text-zinc-450 flex items-center gap-4">
          <div>SPOT: <span className="text-emerald-600 font-bold">{store.spotPrice.toFixed(2)}</span></div>
          <div>ATM STRIKE: <span className="text-blue-600 font-bold">{store.atmStrike}</span></div>
          <div>ACTIVE SYMBOLS: <span className="text-zinc-700 font-semibold">{activeCE} / {activePE}</span></div>
        </div>
      </div>

      <div className="flex-1 grid grid-rows-3 md:grid-rows-1 md:grid-cols-3 gap-2.5 min-h-0">
        {/* Spot index pane */}
        <div id="spot_pane" className="flex flex-col bg-white rounded border border-zinc-200/80 overflow-hidden relative">
          <div className="bg-zinc-50/80 px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-200/60">
            <span className="text-[10px] font-mono font-bold text-zinc-700">NIFTY_SPOT (Underlying)</span>
            <span className="text-[10px] font-mono text-emerald-600 font-bold">₹{store.spotPrice.toFixed(2)}</span>
          </div>
          <div className="flex-1 relative min-h-0">
            <ChartCandlestickCanvas
              symbol="NIFTY_SPOT"
              candles={spotCandles}
              type="SPOT"
              width={dimensions.width ? Math.floor(dimensions.width / 3.1) : 300}
              height={dimensions.height ? Math.floor(dimensions.height - 40) : 250}
            />
          </div>
        </div>

        {/* ATM CE pane */}
        <div id="ce_pane" className="flex flex-col bg-white rounded border border-zinc-200/80 overflow-hidden relative">
          <div className="bg-zinc-50/80 px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-200/60">
            <span className="text-[10px] font-mono font-bold text-orange-600">{activeCE} (ATM Call)</span>
            <span className="text-[10px] font-mono text-orange-600 font-bold">
              ₹{ceCandles[ceCandles.length - 1]?.close.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="flex-1 relative min-h-0">
            <ChartCandlestickCanvas
              symbol={activeCE}
              candles={ceCandles}
              type="CE"
              width={dimensions.width ? Math.floor(dimensions.width / 3.1) : 300}
              height={dimensions.height ? Math.floor(dimensions.height - 40) : 250}
            />
          </div>
        </div>

        {/* ATM PE pane */}
        <div id="pe_pane" className="flex flex-col bg-white rounded border border-zinc-200/80 overflow-hidden relative">
          <div className="bg-zinc-50/80 px-2.5 py-1.5 flex items-center justify-between border-b border-zinc-200/60">
            <span className="text-[10px] font-mono font-bold text-blue-600">{activePE} (ATM Put)</span>
            <span className="text-[10px] font-mono text-blue-600 font-bold">
              ₹{peCandles[peCandles.length - 1]?.close.toFixed(2) || '0.00'}
            </span>
          </div>
          <div className="flex-1 relative min-h-0">
            <ChartCandlestickCanvas
              symbol={activePE}
              candles={peCandles}
              type="PE"
              width={dimensions.width ? Math.floor(dimensions.width / 3.1) : 300}
              height={dimensions.height ? Math.floor(dimensions.height - 40) : 250}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
