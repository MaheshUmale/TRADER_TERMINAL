import React, { useRef, useEffect } from 'react';
import { useTerminalStore } from '../store';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

export function AnalyticsPanel() {
  const store = useTerminalStore();
  const signals = store.marketSignals;
  const pcrData = store.pcrValues;

  const containerRef = useRef<HTMLDivElement>(null);

  // Auto scroll interpretation ticker when new signals arrive without scrolling the whole page viewport
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [signals]);

  return (
    <div className="w-full h-full grid grid-cols-1 lg:grid-cols-3 gap-3 p-3 bg-white border border-zinc-200 rounded-lg shadow-xs">
      
      {/* PCR vs SPOT Dual Axis Line Chart */}
      <div className="lg:col-span-2 flex flex-col bg-white rounded border border-zinc-200/80 p-3 min-h-[180px]">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2 mb-2">
          <span className="text-[10px] font-mono font-bold text-zinc-700">PCR (Put-Call Ratio) vs SPOT OVERLAY</span>
          <span className="text-[9px] font-mono text-zinc-450">
            CURRENT PCR: <span className="text-blue-600 font-extrabold">{pcrData[pcrData.length - 1]?.pcr.toFixed(3) || '1.00'}</span>
          </span>
        </div>
        <div className="flex-1 min-h-0 text-[9px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pcrData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis 
                dataKey="timestamp" 
                tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                stroke="#a1a1aa" 
              />
              <YAxis yAxisId="left" stroke="#10b981" domain={['auto', 'auto']} />
              <YAxis yAxisId="right" orientation="right" stroke="#2563eb" domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e4e4e7', borderRadius: '4px', color: '#18181b' }}
                labelStyle={{ color: '#27272a', fontSize: '10px', fontWeight: 'bold' }}
                itemStyle={{ fontSize: '10px' }}
              />
              <Legend wrapperStyle={{ fontSize: '9px', marginTop: '-10px' }} />
              <Line 
                yAxisId="left" 
                type="monotone" 
                name="NIFTY SPOT" 
                dataKey="spot" 
                stroke="#10b981" 
                dot={false} 
                strokeWidth={1.5} 
              />
              <Line 
                yAxisId="right" 
                type="monotone" 
                name="PUT/CALL RATIO" 
                dataKey="pcr" 
                stroke="#2563eb" 
                dot={false} 
                strokeWidth={1.5} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sentiment Interpretation Log */}
      <div className="flex flex-col bg-white rounded border border-zinc-200/80 p-3 min-h-[180px]">
        <div className="border-b border-zinc-100 pb-2 mb-2 flex items-center justify-between">
          <div className="text-[10px] font-mono font-bold text-zinc-700">SENTIMENT INTERPRETATION LOG</div>
          <div className="text-[8px] bg-zinc-100 border border-zinc-200 text-zinc-500 px-1.5 py-0.5 rounded uppercase font-mono font-semibold">
            Rule Engine Active
          </div>
        </div>
        
        {/* Signals ticking buffer table */}
        <div 
          ref={containerRef}
          id="logs_container" 
          className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 max-h-[140px] text-[10px] font-mono"
        >
          {signals.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-1 text-[10px] select-none py-6">
              <span>Awaiting price trend updates ...</span>
              <span className="text-[9px] text-zinc-400">Hold on for LIVE or REPLAY ticks.</span>
            </div>
          ) : (
            signals.map((sig, idx) => {
              const dateStr = new Date(sig.timestamp).toLocaleTimeString([], { hour12: false });
              const isLong = sig.interpretation === 'LONG BUILDUP';
              return (
                <div 
                  key={idx} 
                  className="flex items-start gap-1 p-1 bg-zinc-50 border border-zinc-200/60 rounded hover:bg-zinc-100/50"
                >
                  <span className="text-zinc-400 font-bold text-[9px] mt-0.5">{dateStr}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-800 font-bold">{sig.symbol}</span>
                      <span className="text-zinc-650 font-semibold">₹{sig.price}</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] mt-0.5">
                      <div className="flex gap-1.5 text-[8px]">
                        <span className={isLong ? 'text-emerald-600' : 'text-rose-600'}>
                          Price: {sig.changeInPrice > 0 ? `+${sig.changeInPrice}` : sig.changeInPrice}
                        </span>
                        <span className="text-blue-600">OI: {sig.changeInOI > 0 ? `+${sig.changeInOI}` : sig.changeInOI}</span>
                      </div>
                      <span className={`px-1 py-0.2 rounded font-extrabold text-[8px] ${
                        isLong ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                      }`}>
                        {sig.interpretation}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
