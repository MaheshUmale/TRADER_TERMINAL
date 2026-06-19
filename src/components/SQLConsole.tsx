import React, { useState } from 'react';
import { useTerminalStore } from '../store';
import { Database, Play, AlertCircle } from 'lucide-react';

export function SQLConsole() {
  const store = useTerminalStore();
  const [queryInput, setQueryInput] = useState(store.sqlQuery);

  const sampleQueries = [
    {
      label: 'Spot Live Candles',
      sql: "SELECT timestamp, symbol, close, volume FROM asset_candles_10s WHERE symbol = 'NIFTY_SPOT' ORDER BY timestamp DESC LIMIT 5;"
    },
    {
      label: 'ATM Option Premium',
      sql: `SELECT timestamp, symbol, close, open_interest FROM asset_candles_10s WHERE symbol = 'NIFTY_${store.atmStrike}_CE' ORDER BY timestamp DESC LIMIT 5;`
    },
    {
      label: 'Volume Profiles',
      sql: `SELECT symbol, MAX(close) as HIGH_PEAK, SUM(volume) as TOTAL_VOL FROM asset_candles_10s GROUP BY symbol LIMIT 10;`
    }
  ];

  const handleRun = () => {
    store.runSqlQuery(queryInput);
  };

  const applySample = (sql: string) => {
    setQueryInput(sql);
    store.runSqlQuery(sql);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3.5 min-h-[220px] shadow-xs">
      
      {/* Console Title */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-850 flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-blue-600" />
          ANALYTICAL STORAGE ENGINE (DUCKDB-WASM INTERACTION CONSOLE)
        </span>
        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-1.5 rounded uppercase font-mono font-bold">
          OPFS Connected
        </span>
      </div>

      {/* Query shortcuts */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[10px] text-zinc-450 font-mono mt-0.5">SAMPLE SCRIPTS:</span>
        {sampleQueries.map((q, idx) => (
          <button
            key={idx}
            onClick={() => applySample(q.sql)}
            className="text-[9px] bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded cursor-pointer transition-colors font-mono"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Inputs and editor console pane */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 flex flex-col gap-2">
          <textarea
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            className="w-full h-24 bg-zinc-50 text-zinc-800 border border-zinc-200 hover:border-zinc-300 focus:bg-white focus:border-zinc-800 rounded p-2.5 text-xs font-mono focus:outline-hidden leading-relaxed resize-none cursor-text shadow-inner"
            placeholder="SELECT * FROM asset_candles_10s LIMIT 10..."
          />
          <button
            onClick={handleRun}
            className="flex items-center justify-center gap-1 py-1.5 px-3.5 bg-zinc-900 hover:bg-zinc-950 text-white font-mono font-bold text-[11px] rounded transition-colors cursor-pointer shadow-xs active:scale-98 self-start"
          >
            <Play className="w-3 h-3 fill-current" />
            EXECUTE DUCKDB SQL
          </button>
        </div>

        {/* Console outputs results box */}
        <div className="flex-1 bg-zinc-50 rounded border border-zinc-200/80 flex flex-col min-h-[140px] max-h-[140px] overflow-hidden">
          <div className="bg-zinc-100 px-2.5 py-1.5 border-b border-zinc-200 flex items-center justify-between text-[10px] font-mono font-bold text-zinc-500">
            <span>QUERY TRANSACTION OUTPUT</span>
            <span>ROWS RETRIEVED: {store.sqlConsoleResult?.rows.length || 0}</span>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {store.sqlConsoleError ? (
              <div className="flex items-start gap-1.5 text-rose-700 font-mono text-[10px] p-2 bg-rose-50 rounded border border-rose-100">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{store.sqlConsoleError}</span>
              </div>
            ) : store.sqlConsoleResult ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-[10px] border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-zinc-200 text-zinc-600">
                      {store.sqlConsoleResult.columns.map((col, idx) => (
                        <th key={idx} className="pb-1 pr-3 font-bold">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 text-zinc-700">
                    {store.sqlConsoleResult.rows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-zinc-100/60">
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx} className="py-1 pr-3 font-mono text-zinc-850">
                            {cell !== null ? String(cell) : 'NULL'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-zinc-400 font-mono text-[9px] select-none py-6">
                <span>Enter query script and click execute.</span>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
