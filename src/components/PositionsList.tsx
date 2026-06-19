import React, { useState } from 'react';
import { useTerminalStore } from '../store';
import { ShieldCheck, History, Landmark, XCircle } from 'lucide-react';

export function PositionsList() {
  const store = useTerminalStore();
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'ORDERS'>('POSITIONS');

  const positions = store.positions;
  const orders = store.orders;

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-4 min-h-[190px] shadow-xs">
      
      {/* Tab Selectors & Cap Readouts */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-zinc-100 pb-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            id="tab_positions"
            className={`px-3.5 py-1.5 font-mono text-xs font-extrabold rounded-md cursor-pointer transition-all duration-200 ${
              activeTab === 'POSITIONS'
                ? 'bg-zinc-900 border border-zinc-950 text-white shadow-xs font-extrabold'
                : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100/60'
            }`}
          >
            ACTIVE POSITIONS MATRIX ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('ORDERS')}
            id="tab_orders"
            className={`px-3.5 py-1.5 font-mono text-xs font-extrabold rounded-md cursor-pointer transition-all duration-200 ${
              activeTab === 'ORDERS'
                ? 'bg-zinc-900 border border-zinc-950 text-white shadow-xs font-extrabold'
                : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100/60'
            }`}
          >
            ORDER LEDGER BOOK ({orders.length})
          </button>
        </div>

        {/* Capital Summary Matrix */}
        <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono font-bold bg-zinc-50 border border-zinc-250/80 px-3 py-1.5 rounded">
          <div className="flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5 text-zinc-455" />
            <span className="text-zinc-500 font-semibold">MARGIN FREE:</span>
            <span className="text-blue-600 font-bold">₹{store.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-zinc-250 pl-3">
            <span className="text-zinc-500 font-semibold">USED:</span>
            <span className="text-orange-600 font-bold">₹{store.usedMargin.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
          </div>
          <div className="flex items-center gap-1.5 border-l border-zinc-250 pl-3">
            <span className="text-zinc-500 font-semibold">TOTAL FLOATING:</span>
            <span className={store.totalPnL >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
              {store.totalPnL >= 0 ? `+₹${store.totalPnL.toFixed(1)}` : `-₹${Math.abs(store.totalPnL).toFixed(1)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Dynamic Content Panel */}
      <div className="flex-1 overflow-x-auto min-h-0">
        {activeTab === 'POSITIONS' ? (
          positions.length === 0 ? (
            <div className="h-28 flex flex-col items-center justify-center text-zinc-400 gap-1 font-mono text-xs select-none">
              <ShieldCheck className="w-5 h-5 text-zinc-300" />
              <span>No active investment risk. Ready to execute option chains.</span>
            </div>
          ) : (
            <table className="w-full text-left font-mono text-[11px] whitespace-nowrap min-w-[500px]">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-200 bg-zinc-50 text-[10px]">
                  <th className="p-2.5">SYMBOL</th>
                  <th className="p-2.5">CONTRACT TYPE</th>
                  <th className="p-2.5">AVG COST</th>
                  <th className="p-2.5">CURRENT LTP</th>
                  <th className="p-2.5">QUANTITY (SIZE)</th>
                  <th className="p-2.5">TRAILING STOP-LOSS (SL)</th>
                  <th className="p-2.5 text-right">FLOATING PNL</th>
                  <th className="p-2.5 text-center">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {positions.map((pos) => {
                  const isProfit = pos.pnl >= 0;
                  return (
                    <tr key={pos.symbol} className="hover:bg-zinc-50/50 transition-all duration-150">
                      <td className="p-2.5 font-bold text-zinc-900">{pos.symbol}</td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] ${
                          pos.optionType === 'CE' ? 'bg-orange-50 text-orange-700 border border-orange-200/50' : 'bg-blue-50 text-blue-700 border border-blue-200/50'
                        }`}>
                          {pos.optionType} {pos.strike}
                        </span>
                      </td>
                      <td className="p-2.5 text-zinc-600">₹{pos.avgCost.toFixed(1)}</td>
                      <td className="p-2.5 font-bold text-zinc-800">₹{pos.ltp.toFixed(1)}</td>
                      <td className="p-2.5 text-zinc-800 font-bold">{pos.quantity * store.lotSize}</td>
                      <td className="p-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="1"
                            max={Math.floor(pos.ltp * 0.95)}
                            value={pos.trailingSL || 1}
                            className="w-20 accent-zinc-700 cursor-pointer"
                            onChange={(e) => store.updateTrailingSL(pos.symbol, Number(e.target.value))}
                          />
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 rounded border border-blue-105">
                            {pos.trailingSL ? `₹${pos.trailingSL}` : 'Off'}
                          </span>
                        </div>
                      </td>
                      <td className={`p-2.5 text-right font-bold text-xs ${isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isProfit ? `+₹${pos.pnl}` : `-₹${Math.abs(pos.pnl)}`}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          onClick={() => store.exitSinglePosition(pos.symbol)}
                          className="px-2.5 py-0.5 bg-rose-50 border border-rose-150 hover:bg-rose-600 hover:text-white text-rose-600 text-[10px] font-bold rounded cursor-pointer transition-colors"
                        >
                          EXIT
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : (
          // Order History Tab Content
          orders.length === 0 ? (
            <div className="h-28 flex flex-col items-center justify-center text-zinc-400 gap-1 font-mono text-xs select-none">
              <History className="w-5 h-5 text-zinc-300" />
              <span>Order history logs is empty. Place quick contracts to fill.</span>
            </div>
          ) : (
            <table className="w-full text-left font-mono text-[11px] whitespace-nowrap min-w-[500px]">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-200 bg-zinc-50 text-[10px]">
                  <th className="p-2.5">ORDER ID</th>
                  <th className="p-2.5">TIMESTAMP</th>
                  <th className="p-2.5">CONTRACT</th>
                  <th className="p-2.5">DIRECTION</th>
                  <th className="p-2.5">PRICE</th>
                  <th className="p-2.5">QTY</th>
                  <th className="p-2.5 text-center">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {orders.map((ord) => {
                  const isBuy = ord.action === 'BUY';
                  const isFilled = ord.status === 'FILLED';
                  const dateStr = new Date(ord.timestamp).toLocaleTimeString([], { hour12: false });
                  return (
                    <tr key={ord.id} className="hover:bg-zinc-50/50 transition-all duration-150">
                      <td className="p-2.5 text-zinc-400">{ord.id}</td>
                      <td className="p-2.5 text-zinc-400">{dateStr}</td>
                      <td className="p-2.5 font-bold text-zinc-800">
                        {ord.symbol} ({ord.optionType})
                      </td>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded font-mono font-bold text-[9px] ${
                          isBuy ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                        }`}>
                          {ord.action}
                        </span>
                      </td>
                      <td className="p-2.5 font-semibold text-zinc-700">₹{ord.price.toFixed(1)}</td>
                      <td className="p-2.5 text-zinc-650">{ord.quantity * store.lotSize}</td>
                      <td className="p-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          isFilled ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                        }`}>
                          {ord.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>

    </div>
  );
}
