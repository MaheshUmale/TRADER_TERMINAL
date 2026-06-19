import React from 'react';
import { useTerminalStore } from '../store';
import { AlertTriangle, Power } from 'lucide-react';

export function ExecutionDock() {
  const store = useTerminalStore();

  const activeLotMult = store.lotMultiplier;
  const activeOrderType = store.orderType;

  return (
    <div className="bg-white p-4 rounded-lg border border-zinc-200 shadow-xs flex flex-col gap-4">
      {/* Dock Title */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-850 flex items-center gap-1.5">
          <Power className="w-3.5 h-3.5 text-blue-600" />
          GLOBAL EXECUTION CONTROL DOCK
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-400">STATUS:</span>
          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded uppercase font-mono font-extrabold">
            CONNECTED
          </span>
        </div>
      </div>

      {/* Lot multipliers */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-mono font-bold text-zinc-500">LOT MULTIPLIER (NIFTY Lot = 50 Qty)</label>
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 5, 10].map((mult) => {
            const isActive = activeLotMult === mult;
            return (
              <button
                key={mult}
                onClick={() => store.setLotMultiplier(mult)}
                id={`btn_lot_mult_${mult}`}
                className={`py-1.5 px-2 rounded font-mono font-extrabold text-xs cursor-pointer transition-all duration-200 ${
                  isActive
                    ? 'bg-zinc-900 border border-zinc-950 text-white shadow-xs font-black'
                    : 'bg-zinc-50 hover:bg-zinc-105 hover:text-zinc-800 border border-zinc-200/80 text-zinc-500'
                }`}
              >
                x{mult} <span className="text-[9px] font-medium opacity-85">({mult * store.lotSize})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Order Type selects */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-mono font-bold text-zinc-500">ORDER TYPE</label>
        <div className="grid grid-cols-3 gap-1.5">
          {['MARKET', 'LIMIT', 'SL'].map((type) => {
            const isActive = activeOrderType === type;
            return (
              <button
                key={type}
                onClick={() => store.setOrderType(type as any)}
                id={`btn_order_type_${type}`}
                className={`py-1.5 rounded font-mono font-bold text-[10px] cursor-pointer transition-all duration-200 ${
                  isActive
                    ? 'bg-zinc-900 border border-zinc-950 text-white shadow-xs font-black'
                    : 'bg-zinc-50 hover:bg-zinc-105 hover:text-zinc-800 border border-zinc-200/80 text-zinc-500'
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Order parameter limits */}
      {activeOrderType !== 'MARKET' && (
        <div className="grid grid-cols-2 gap-2 anim-fade-in p-2.5 bg-zinc-50 rounded border border-zinc-200/60">
          {activeOrderType === 'LIMIT' && (
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[9px] font-mono text-zinc-500">LIMIT EXECUTION PRICE (₹)</label>
              <input
                type="number"
                value={store.limitPrice}
                onChange={(e) => store.setLimitPrice(Number(e.target.value))}
                className="bg-white text-zinc-800 border border-zinc-300 rounded px-2 py-1 text-xs font-mono focus:outline-hidden focus:border-zinc-500 w-full"
              />
            </div>
          )}
          {activeOrderType === 'SL' && (
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[9px] font-mono text-zinc-500">STOP LOSS TRIGGER PRICE (₹)</label>
              <input
                type="number"
                value={store.slTriggerPrice}
                onChange={(e) => store.setSLTriggerPrice(Number(e.target.value))}
                className="bg-white text-zinc-800 border border-zinc-300 rounded px-2 py-1 text-xs font-mono focus:outline-hidden focus:border-zinc-500 w-full"
              />
            </div>
          )}
        </div>
      )}

      {/* Extreme Protection Exit all lever */}
      <div className="mt-2 pt-1 border-t border-zinc-100">
        <button
          onClick={store.exitAllPositions}
          id="btn_exit_all_panic"
          className="w-full py-2.5 px-3 bg-red-500 hover:bg-red-650 text-white font-mono font-bold text-xs rounded border border-red-500 hover:border-red-600 flex items-center justify-center gap-2 transition-all duration-300 shadow-xs uppercase tracking-wider cursor-pointer group active:scale-98"
        >
          <AlertTriangle className="w-4 h-4 group-hover:scale-110" />
          EXIT ALL ACTIVE POSITIONS
        </button>
      </div>
    </div>
  );
}
