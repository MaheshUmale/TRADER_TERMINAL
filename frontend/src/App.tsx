import React, { useEffect, useState } from 'react';
import { useTerminalStore } from './store';
import { TripleChartGrid } from './components/TripleChartGrid';
import { OptionChain } from './components/OptionChain';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { MarketStructure } from './components/MarketStructure';
import { ExecutionDock } from './components/ExecutionDock';
import { PositionsList } from './components/PositionsList';
import { SQLConsole } from './components/SQLConsole';
import { UpstoxConnectCenter } from './components/UpstoxConnectCenter';
import { Play, Pause, RotateCcw, Activity, Eye, Zap, RefreshCw } from 'lucide-react';

export default function App() {
  const store = useTerminalStore();
  const [activeWorkspace, setActiveWorkspace] = useState<'OPTIONS' | 'STRUCTURE' | 'UPSTOX_INTEGRATION'>('OPTIONS');
  const autoConnectRef = React.useRef(false);

  // Initialize beautiful historical database contents on mount
  useEffect(() => {
    store.initHistoricalData();
    store.fetchBackendHealth();

    fetch('/api/upstox-config')
      .then(res => res.json())
      .then(config => {
        if (config.hasToken && !autoConnectRef.current) {
          autoConnectRef.current = true;
          store.connectUpstoxServerEnv();
        }
      })
      .catch(() => undefined);
  }, []);

  // 1. Live Feed Simulator Loop (ticks every 400ms when connected in LIVE mode)
  useEffect(() => {
    if (store.marketActiveMode !== 'LIVE') return;
    // Skip simulated updates if real-time Upstox data synchronization is active
    if (store.isUpstoxConnected && store.isUpstoxLiveSynced && store.upstoxToken && !store.upstoxToken.toLowerCase().includes('mock')) {
      return;
    }

    const interval = setInterval(() => {
      // Oscillation underlier with slightly positive structural drift expectation
      const drift = 0.05;
      const noise = (Math.random() - 0.495) * 5;
      const nextSpotPrice = store.spotPrice + drift + noise;
      store.tickLiveFeed(nextSpotPrice);
    }, 400);

    return () => clearInterval(interval);
  }, [store.marketActiveMode, store.spotPrice, store.isUpstoxLiveSynced, store.upstoxToken, store.isUpstoxConnected]);

  // 2. Replay Feed Head Playback Loop
  useEffect(() => {
    if (store.marketActiveMode !== 'REPLAY' || !store.replayPlaying) return;

    // Tick playback rate matches speed multiplier options (1x => 1000ms, 10x => 100ms)
    const baseInterval = 1000;
    const playRate = baseInterval / store.replaySpeed;

    const interval = setInterval(() => {
      store.stepReplayForward();
    }, playRate);

    return () => clearInterval(interval);
  }, [store.marketActiveMode, store.replayPlaying, store.replaySpeed, store.replayIndex]);

  // 3. Upstox Account Synchronization Loop
  useEffect(() => {
    if (!store.isUpstoxConnected || !store.isUpstoxLiveSynced || !store.upstoxToken) return;

    const isMock = false; // store.upstoxToken.toLowerCase().includes('mock');

    // Run immediately on active sync trigger
    if (!isMock) {
      store.fetchUpstoxOptionChain();
    }

    // Refresh Upstox positions, margins & option chain every 4.5 seconds
    const interval = setInterval(() => {
      store.fetchUpstoxMargin();
      store.fetchUpstoxPositions();
      if (!isMock) {
        store.fetchUpstoxOptionChain();
      }
    }, 4500);

    return () => clearInterval(interval);
  }, [store.isUpstoxConnected, store.isUpstoxLiveSynced, store.upstoxToken]);

  // 4. High-Speed Upstox WebSocket State Polling Loop (Tick-by-tick charts)
  useEffect(() => {
    if (!store.isUpstoxConnected || !store.isUpstoxLiveSynced || !store.upstoxToken) return;
    const isMock = store.upstoxToken.toLowerCase().includes('mock');
    if (isMock) return;

    // Run tick-by-tick polling loop every 1200ms
    const interval = setInterval(() => {
      store.pollUpstoxLiveTicks();
    }, 1200);

    return () => clearInterval(interval);
  }, [store.isUpstoxConnected, store.isUpstoxLiveSynced, store.upstoxToken]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-800 flex flex-col font-sans select-none antialiased selection:bg-zinc-200 selection:text-zinc-900">
      
      {/* Dynamic Header Controls & Navigation bar */}
      <header className="border-b border-zinc-200/80 bg-white px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 sticky top-0 z-50 shadow-xs">
        
        {/* Logo and Live index spot stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-zinc-900 flex items-center justify-center font-black text-xs text-white uppercase tracking-wider">
              T
            </div>
            <div>
              <h1 className="text-xs font-bold uppercase tracking-wider text-zinc-900 leading-none">
                TRADERS TERMINAL
              </h1>
              <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest leading-none block mt-1">
                Python SDK Backend • Upstox v3 Feed
              </span>
            </div>
          </div>

          {/* SPOT Index readouts */}
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 px-3 py-1 rounded">
            <Activity className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
            <div className="text-[10px] font-mono text-zinc-500 font-bold uppercase">NIFTY:</div>
            <div className="text-xs font-mono font-black text-emerald-600 tracking-tight">
              {store.spotPrice.toFixed(2)}
            </div>
            <div className={`text-[9px] font-mono font-bold ${
              store.spotPrice >= store.prevSpotPrice ? 'text-emerald-600' : 'text-rose-600'
            }`}>
              {store.spotPrice >= store.prevSpotPrice ? '▲' : '▼'}
            </div>
          </div>

          <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded border text-[10px] font-mono font-bold uppercase ${
            store.backendStatus === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : store.backendStatus === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : 'bg-zinc-50 border-zinc-200 text-zinc-500'
          }`}>
            {store.backendStatus === 'ok' ? 'BACKEND ONLINE' : store.backendStatus === 'error' ? 'BACKEND OFFLINE' : 'BACKEND CHECKING'}
            {store.backendMode ? `• ${store.backendMode}` : ''}
          </div>
        </div>

        {/* Tab workspace controller toggles */}
        <div className="flex items-center gap-1 bg-zinc-100 border border-zinc-200 rounded p-1 self-start md:self-auto">
          <button
            onClick={() => setActiveWorkspace('OPTIONS')}
            id="workspace_options_tab"
            className={`px-3 py-1 rounded font-mono text-[10px] uppercase font-bold cursor-pointer transition-all duration-200 ${
              activeWorkspace === 'OPTIONS'
                ? 'bg-white text-zinc-950 border border-zinc-200 shadow-xs font-extrabold'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            Options & Order Flow Workspace
          </button>
          <button
            onClick={() => setActiveWorkspace('STRUCTURE')}
            id="workspace_structure_tab"
            className={`px-3 py-1 rounded font-mono text-[10px] uppercase font-bold cursor-pointer transition-all duration-200 ${
              activeWorkspace === 'STRUCTURE'
                ? 'bg-white text-zinc-950 border border-zinc-200 shadow-xs font-extrabold'
                : 'text-zinc-400 hover:text-zinc-800'
            }`}
          >
            Market Structure Workspace
          </button>
          <button
            onClick={() => setActiveWorkspace('UPSTOX_INTEGRATION')}
            id="workspace_upstox_tab"
            className={`px-3 py-1 rounded font-mono text-[10px] uppercase font-bold cursor-pointer transition-all duration-200 ${
              activeWorkspace === 'UPSTOX_INTEGRATION'
                ? 'bg-white text-zinc-950 border border-zinc-200 shadow-xs font-extrabold'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            Upstox Integration
          </button>
        </div>

        {/* Playback mode & simulation speeds segment */}
        <div className="flex items-center gap-3">
          
          {/* Mode Switchers */}
          <div className="flex items-center gap-1.5 border-r border-zinc-200 pr-3">
            <span className="text-[9px] font-mono font-bold text-zinc-400 mr-1.5 uppercase">DRIVER MODE:</span>
            <button
              onClick={() => store.setMode('LIVE')}
              id="mode_live"
              className={`px-2 py-1 rounded text-[9px] font-mono font-bold cursor-pointer transition-all ${
                store.marketActiveMode === 'LIVE'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 font-extrabold'
                  : 'bg-zinc-105 hover:bg-zinc-200 text-zinc-600 border border-zinc-200'
              }`}
            >
              LIVE STREAM
            </button>
            <button
              onClick={async () => await store.setMode('REPLAY')}
              id="mode_replay"
              className={`px-2 py-1 rounded text-[9px] font-mono font-bold cursor-pointer transition-all ${
                store.marketActiveMode === 'REPLAY'
                  ? 'bg-blue-50 border border-blue-200 text-blue-700 font-extrabold'
                  : 'bg-zinc-105 hover:bg-zinc-200 text-zinc-600 border border-zinc-200'
              }`}
            >
              REPLAY BACKTEST
            </button>
          </div>

          {/* Replay controller deck */}
          {store.marketActiveMode === 'REPLAY' && (
            <div className="flex items-center gap-2 anim-scale-in">
              {/* Play / pause */}
              <button
                onClick={store.toggleReplayPlay}
                id="btn_replay_toggle"
                className="p-1 px-2.5 bg-white hover:bg-zinc-50 text-blue-600 border border-zinc-200 rounded flex items-center gap-1 cursor-pointer shadow-xs"
              >
                {store.replayPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                <span className="text-[9px] font-mono font-bold">{store.replayPlaying ? 'PAUSE' : 'PLAY'}</span>
              </button>

              {/* Reset head */}
              <button
                onClick={store.resetReplayHead}
                id="btn_replay_reset"
                className="p-1 bg-white hover:bg-zinc-50 text-zinc-500 border border-zinc-200 rounded cursor-pointer shadow-xs"
                title="Reset Replay Timeline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Speed Multipliers */}
              <div className="flex items-center gap-1 bg-zinc-50 p-0.5 rounded border border-zinc-200 font-mono text-[9px]">
                {[1, 2, 5, 10].map((sp) => (
                  <button
                    key={sp}
                    onClick={() => store.setReplaySpeed(sp as any)}
                    className={`px-1 rounded-xs font-bold cursor-pointer transition-colors ${
                      store.replaySpeed === sp ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-600'
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </header>

      {/* Main Container contents grid */}
      <main className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto max-w-[1720px] w-full mx-auto">
        
        {/* Active layout switcher grid */}
        {activeWorkspace === 'OPTIONS' ? (
          // Screen 1: Options & Order Flow Workspace
          <>
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
              {/* Left Section 3 Grid elements */}
              <div className="xl:col-span-3 flex flex-col gap-3 min-w-0">
                {/* Row 1: Triple charts grid */}
                <div className="h-[380px] min-h-[300px]">
                  <TripleChartGrid />
                </div>
                
                {/* Row 2: Analytics & Log columns */}
                <div className="min-h-[220px]">
                  <AnalyticsPanel />
                </div>
              </div>

              {/* Right Section options table and executions controls */}
              <div className="xl:col-span-1 flex flex-col gap-3 min-w-0">
                {/* Global order control panel */}
                <ExecutionDock />

                {/* Option Chain table */}
                <div className="flex-1 min-h-[300px] xl:min-h-[360px]">
                  <OptionChain />
                </div>
              </div>
            </div>

            {/* Positions risk matrix & Orders History logs tab */}
            <div className="grid grid-cols-1 md:grid-cols-1 gap-2">
              <PositionsList />
            </div>
          </>
        ) : activeWorkspace === 'STRUCTURE' ? (
          // Screen 2: Market Structure Workspace
          <>
            <div className="h-[480px] min-h-[400px]">
              <MarketStructure />
            </div>

            {/* Positions risk matrix & Orders History logs tab */}
            <div className="grid grid-cols-1 md:grid-cols-1 gap-2">
              <PositionsList />
            </div>
          </>
        ) : (
          // Screen 3: Upstox API Gateway and Connection Center info panel & SQL Console
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1">
              <UpstoxConnectCenter />
            </div>

            <div className="grid grid-cols-1">
              <SQLConsole />
            </div>
          </div>
        )}

      </main>

      {/* System Footer credits */}
      <footer className="border-t border-zinc-200 bg-white px-4 py-2 flex items-center justify-between text-[10px] font-mono text-zinc-450 mt-auto">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-zinc-500" />
          <span>PORT INGRESS ROUTING: localhost:4000</span>
        </div>
        <div>
          <span>CRAFTED IN CLIENT PLATFORM SYSTEM CONTEXT • UTC 2026</span>
        </div>
      </footer>

    </div>
  );
}
