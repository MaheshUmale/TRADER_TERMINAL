import React, { useEffect, useState } from 'react';
import { useTerminalStore } from '../store';
import { OptionChainRow } from '../types';

export function OptionChain() {
  const store = useTerminalStore();
  const optionChain = store.optionChain;

  // Track dynamic flashing highlights when LTP changes
  const [flashes, setFlashes] = useState<{ [key: string]: 'UP' | 'DOWN' | null }>({});

  useEffect(() => {
    const nextFlashes: { [key: string]: 'UP' | 'DOWN' | null } = {};
    optionChain.forEach((row) => {
      // Call Side Flash checks
      const cKey = `call_${row.strike}`;
      if (row.callLtp > row.callPrevLtp) {
        nextFlashes[cKey] = 'UP';
      } else if (row.callLtp < row.callPrevLtp) {
        nextFlashes[cKey] = 'DOWN';
      }

      // Put Side Flash checks
      const pKey = `put_${row.strike}`;
      if (row.putLtp > row.putPrevLtp) {
        nextFlashes[pKey] = 'UP';
      } else if (row.putLtp < row.putPrevLtp) {
        nextFlashes[pKey] = 'DOWN';
      }
    });

    setFlashes(nextFlashes);

    // Timeout to clear flashes
    const timer = setTimeout(() => {
      setFlashes({});
    }, 400);

    return () => clearTimeout(timer);
  }, [optionChain]);

  const handleOrder = (strike: number, type: 'CE' | 'PE', action: 'BUY' | 'SELL') => {
    const symbol = `NIFTY_${strike}_${type}`;
    store.placeOrder(symbol, strike, type, action);
  };

  return (
    <div className="flex flex-col h-full bg-white border border-zinc-200 rounded-lg p-3 shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2 px-1 mb-1">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-850">
          COMPACT OPTION CHAIN desk
        </span>
        <span className="text-[10px] text-zinc-450 font-mono">
          LOT MULTIPLIER: <span className="text-blue-600 font-bold">x{store.lotMultiplier} ({store.lotMultiplier * store.lotSize} Qty)</span>
        </span>
      </div>

      {/* High-density grid header */}
      <div className="grid grid-cols-5 text-center text-[10px] font-mono font-bold text-zinc-500 border-b border-zinc-200 bg-zinc-50 py-1.5 px-0.5">
        <div>CALL LTP</div>
        <div>QUICK CE</div>
        <div className="text-zinc-800">STRIKE</div>
        <div>QUICK PE</div>
        <div>PUT LTP</div>
      </div>

      {/* Option Chain List */}
      <div className="flex-1 overflow-y-auto pr-0.5 space-y-0.5 min-h-0 text-[11px] font-mono">
        {optionChain.map((row) => {
          const isAtm = row.strike === store.atmStrike;
          const callFlash = flashes[`call_${row.strike}`];
          const putFlash = flashes[`put_${row.strike}`];

          return (
            <div
              key={row.strike}
              className={`grid grid-cols-5 items-center text-center py-1 rounded transition-colors duration-200 ${
                isAtm ? 'bg-blue-50/50 border border-blue-200/50 y-scale-102 font-extrabold' : 'hover:bg-zinc-50'
              }`}
            >
              {/* Call Price with flashes */}
              <div
                className={`py-0.5 font-bold transition-all duration-350 rounded mx-1 ${
                  callFlash === 'UP'
                    ? 'bg-emerald-100 text-emerald-800'
                    : callFlash === 'DOWN'
                    ? 'bg-rose-105 text-rose-800'
                    : 'text-emerald-600'
                }`}
              >
                ₹{row.callLtp.toFixed(1)}
              </div>

              {/* Call Instant Actions */}
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => handleOrder(row.strike, 'CE', 'BUY')}
                  id={`btn_buy_ce_${row.strike}`}
                  className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-bold text-[9px] cursor-pointer"
                >
                  B
                </button>
                <button
                  onClick={() => handleOrder(row.strike, 'CE', 'SELL')}
                  id={`btn_sell_ce_${row.strike}`}
                  className="px-2 py-0.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-bold text-[9px] cursor-pointer"
                >
                  S
                </button>
              </div>

              {/* Centered Strike pricing anchor */}
              <div className={`py-0.5 rounded font-extrabold text-[12px] ${
                isAtm ? 'text-blue-700 bg-blue-105/60 font-black' : 'text-zinc-650 bg-zinc-100/80'
              }`}>
                {row.strike}
              </div>

              {/* Put Instant Actions */}
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => handleOrder(row.strike, 'PE', 'BUY')}
                  id={`btn_buy_pe_${row.strike}`}
                  className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-bold text-[9px] cursor-pointer"
                >
                  B
                </button>
                <button
                  onClick={() => handleOrder(row.strike, 'PE', 'SELL')}
                  id={`btn_sell_pe_${row.strike}`}
                  className="px-2 py-0.5 bg-rose-500 hover:bg-rose-600 text-white rounded font-bold text-[9px] cursor-pointer"
                >
                  S
                </button>
              </div>

              {/* Put Price with flashes */}
              <div
                className={`py-0.5 font-bold transition-all duration-350 rounded mx-1 ${
                  putFlash === 'UP'
                    ? 'bg-emerald-100 text-emerald-800'
                    : putFlash === 'DOWN'
                    ? 'bg-rose-105 text-rose-800'
                    : 'text-rose-600'
                }`}
              >
                ₹{row.putLtp.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
