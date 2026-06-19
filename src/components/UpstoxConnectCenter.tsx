import { useState } from 'react';
import { useTerminalStore } from '../store';
import { 
  User, Wallet, Lock, CheckCircle2, XCircle, Code, 
  Terminal, ArrowRight, RefreshCw, Key, Shield, HelpCircle, FileJson, Server
} from 'lucide-react';

const SERVER_ENV_TOKEN = 'SERVER_ENV_TOKEN';

export function UpstoxConnectCenter() {
  const store = useTerminalStore();
  const [tokenInput, setTokenInput] = useState(store.upstoxToken);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSkillTab, setActiveSkillTab] = useState<'profile' | 'margin' | 'positions' | 'holdings'>('profile');
  const [consoleOutput, setConsoleOutput] = useState<string | null>(null);

  // Quick skills spec definition to map with upstox-skills
  const skillsSpec = [
    {
      id: 'get_profile',
      name: 'User Profile Skill',
      description: 'Retrieves authentic trader profile details including email, broker, and subscriber status.',
      endpoint: '/v2/user/profile',
      method: 'GET'
    },
    {
      id: 'get_margin',
      name: 'Funds & Margin Skill',
      description: 'Queries active ledger balances, including equity limits and cash margin utilization.',
      endpoint: '/v2/user/get-margin',
      method: 'GET'
    },
    {
      id: 'get_positions',
      name: 'Positions Audit Skill',
      description: 'Pulls open derivative and equity trading vectors with corresponding dynamic margins.',
      endpoint: '/v2/portfolio/positions',
      method: 'GET'
    },
    {
      id: "get_holdings",
      name: "Long Holdings Skill",
      description: "Recovers standard medium and long-term investment portfolios from the central depository.",
      endpoint: "/v2/portfolio/long-term-holdings",
      method: "GET"
    }
  ];

  const handleTestConnect = async (tokenToUse: string) => {
    if (!tokenToUse.trim()) return;
    setIsLoading(true);
    if (tokenToUse === SERVER_ENV_TOKEN) {
      setConsoleOutput('Executing Python backend server-env auth sequence... [POST /api/upstox/connect-env]');
      try {
        const success = await store.connectUpstoxServerEnv();
        setConsoleOutput(success
          ? 'SUCCESS: Python backend authenticated with configured Upstox token.\nRetrieved full Upstox account metrics.\nSwitched system core to direct Python SDK live sync.'
          : `FAILED: Server-env token rejected.\nReason: ${store.upstoxErrorMessage || 'Incorrect Credentials'}`);
      } catch (e: any) {
        setConsoleOutput(`ERROR: Python backend communication failed.\n${e.message || e}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setConsoleOutput('Executing auth sequence... [POST /api/upstox/user/profile]');
    try {
      const success = await store.connectUpstox(tokenToUse);
      if (success) {
        setConsoleOutput('SUCCESS: Connection authenticated successfully!\nRetrieved full upstox account metrics.\nSwitched system core to direct Upstox live sync.');
      } else {
        setConsoleOutput(`FAILED: Upstox access challenge rejected.\nReason: ${store.upstoxErrorMessage || 'Incorrect Credentials'}`);
      }
    } catch (e: any) {
      setConsoleOutput(`ERROR: Internal gateway proxy communication failed.\n${e.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const executeSkillDirect = async (skillId: string, endpoint: string) => {
    if (!store.isUpstoxConnected) {
      setConsoleOutput('SKILL FAILURE: You must configure and connect an Upstox access token first.');
      return;
    }
    setIsLoading(true);
    setConsoleOutput(`Calling Skill Tool: [${skillId.toUpperCase()}] ...\nGET ${endpoint}`);

    // Sandbox Mock Path
    if (store.upstoxToken.toLowerCase().includes('mock') || store.upstoxToken.toLowerCase().includes('sandbox')) {
      setTimeout(() => {
        setIsLoading(false);
        if (skillId === 'get_profile') {
          setConsoleOutput(JSON.stringify({
            status: "success",
            data: store.upstoxProfile
          }, null, 2));
        } else if (skillId === 'get_margin') {
          setConsoleOutput(JSON.stringify({
            status: "success",
            data: {
              equity: store.upstoxMargin,
              commodity: { available_margin: 0, used_margin: 0, payin_amount: 0 }
            }
          }, null, 2));
        } else if (skillId === 'get_positions') {
          setConsoleOutput(JSON.stringify({
            status: "success",
            data: store.positions.map(p => ({
              exchange: 'NSE_FO',
              trading_symbol: p.symbol,
              multiplier: 1,
              quantity: p.quantity,
              average_price: p.avgCost,
              last_price: p.ltp,
              pnl: p.pnl
            }))
          }, null, 2));
        } else {
          setConsoleOutput(JSON.stringify({
            status: "success",
            data: [
              { company_name: "RELIANCE INDUSTRIES LTD", trading_symbol: "RELIANCE", quantity: 15, average_price: 2450.50, last_price: 2510.20 },
              { company_name: "TATA CONSULTANCY SERVICES", trading_symbol: "TCS", quantity: 8, average_price: 3410.00, last_price: 3380.15 }
            ]
          }, null, 2));
        }
      }, 500);
      return;
    }

    // Real API Call
    try {
      const res = await fetch(`/api/upstox${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${store.upstoxToken}`
        }
      });
      const resData = await res.json();
      setConsoleOutput(JSON.stringify(resData, null, 2));
    } catch (err: any) {
      setConsoleOutput(`SKILL SYSTEM EXCEPTION:\n${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const triggerManualRefresh = () => {
    store.fetchUpstoxProfile();
    store.fetchUpstoxMargin();
    store.fetchUpstoxPositions();
    setConsoleOutput(`Manually polling Upstox API records... [${new Date().toLocaleTimeString()}]`);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-4 shadow-xs">
      
      {/* Title block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-white">
            <Shield className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-zinc-900 leading-none">
              UPSTOX API INTEGRATION GATEWAY
            </h2>
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block mt-1">
              Connect private API credentials through the Python FastAPI gateway and Upstox SDK skills
            </span>
          </div>
        </div>

        {/* Sync/Status Pill */}
        <div className="flex items-center gap-2">
          {store.isUpstoxConnected ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-mono font-bold animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              UPSTOX ACCOUNT CONNECTED
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-50 border border-zinc-200 text-zinc-500 text-[10px] font-mono font-bold">
              <Lock className="w-3.5 h-3.5 text-zinc-450 shrink-0" />
              SANDBOX SIMULATED MODE
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Column: Connection & Dashboard */}
        <div className="lg:col-span-5 flex flex-col gap-3.5 justify-start">
          
          {/* Token Form */}
          <div className="bg-zinc-50 border border-zinc-200 rounded p-3.5 flex flex-col gap-3">
            <span className="text-[10px] font-bold text-zinc-700 tracking-wider flex items-center gap-1.5 font-mono uppercase">
              <Key className="w-3.5 h-3.5 text-zinc-500" />
              Secure Authorization Input
            </span>
            
            <p className="text-[10px] text-zinc-550 leading-relaxed font-mono">
              Retrieve your <b>ACCESS_TOKEN</b> from Upstox Developer Portal, or place it in <b>UPSTOX_ACCESS_TOKEN</b> in .env/config.py for Python backend-only calls.
            </p>

            <div className="flex flex-col gap-2">
              <input 
                type="password"
                placeholder="Paste Upstox Access Token..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full bg-white text-zinc-805 border border-zinc-200 rounded px-2.5 py-1.5 text-xs font-mono tracking-wider focus:outline-hidden focus:border-zinc-800 transition-all placeholder:text-zinc-350"
              />
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => handleTestConnect(tokenInput)}
                  disabled={isLoading || !tokenInput}
                  className="flex-1 py-1.5 px-3 bg-zinc-900 border border-zinc-950 hover:bg-zinc-950 text-white font-mono font-bold text-[10px] rounded cursor-pointer transition-all disabled:opacity-50 select-none text-center"
                >
                  {isLoading ? 'CHALLENGING...' : 'AUTHORIZE ACCESS'}
                </button>

                <button
                  onClick={() => {
                    setTokenInput(SERVER_ENV_TOKEN);
                    handleTestConnect(SERVER_ENV_TOKEN);
                  }}
                  disabled={isLoading}
                  className="py-1.5 px-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-mono font-bold text-[9px] rounded cursor-pointer transition-all select-none disabled:opacity-50"
                  title="Use UPSTOX_ACCESS_TOKEN configured in .env or config.py on the Python backend"
                >
                  <span className="flex items-center gap-1"><Server className="w-2.5 h-2.5" />SERVER TOKEN</span>
                </button>
                
                {/* Seed sandbox helper button */}
                <button
                  onClick={() => {
                    setTokenInput('SANDBOX_MOCK_TOKEN_NIFTY_SKILL');
                    handleTestConnect('SANDBOX_MOCK_TOKEN_NIFTY_SKILL');
                  }}
                  className="py-1.5 px-2.5 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-mono font-bold text-[10px] rounded cursor-pointer transition-all select-none"
                  title="Connect with secure demo credential"
                >
                  MOCK ACCOUNT
                </button>
              </div>
            </div>

            {store.upstoxErrorMessage && (
              <div className="p-2 bg-rose-50 border border-rose-100 text-rose-700 font-mono text-[9px] rounded flex gap-1.5 items-start mt-1">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-600" />
                <span>{store.upstoxErrorMessage}</span>
              </div>
            )}
          </div>

          {/* Connected Profile Details */}
          {store.isUpstoxConnected && store.upstoxProfile && (
            <div className="border border-zinc-200 rounded p-3.5 flex flex-col gap-3 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <span className="text-[10px] font-bold text-zinc-800 font-mono uppercase flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-zinc-550" />
                  AUTHENTICATED PROFILE
                </span>
                <span className="text-[9px] bg-purple-50 text-purple-700 border border-purple-100 font-mono font-bold px-1.5 rounded uppercase">
                  {store.upstoxProfile.user_type || 'RETAIL'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono leading-relaxed">
                <div>
                  <span className="text-zinc-400 block uppercase">SUBSCRIBER:</span>
                  <span className="text-zinc-800 font-extrabold">{store.upstoxProfile.name}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block uppercase">MEMBER ID:</span>
                  <span className="text-zinc-800 font-extrabold">{store.upstoxProfile.member_id}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block uppercase">EMAIL REGISTERED:</span>
                  <span className="text-zinc-800 font-medium truncate block max-w-[150px]">{store.upstoxProfile.email}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block uppercase">ROUTING APPS:</span>
                  <span className="text-zinc-800 font-extrabold">{store.upstoxProfile.broker || 'UPSTOX'}</span>
                </div>
              </div>

              {/* Connected Margin Segment */}
              <div className="bg-zinc-25 border border-zinc-200/60 rounded p-2.5 mt-1 flex flex-col gap-2">
                <span className="text-[9px] font-extrabold text-zinc-500 font-mono uppercase flex items-center gap-1">
                  <Wallet className="w-3.5 h-3.5 text-zinc-450" />
                  CREDITED MARGINS LIMIT
                </span>
                
                <div className="flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="text-[9px] text-zinc-400 block">AVAILABLE</span>
                    <span className="text-blue-700 font-black">
                      ₹{store.upstoxMargin?.available_margin.toLocaleString(undefined, { minimumFractionDigits: 1 }) || '0.0'}
                    </span>
                  </div>
                  <div className="border-l border-zinc-200 pl-3">
                    <span className="text-[9px] text-zinc-400 block">USED</span>
                    <span className="text-orange-700 font-black">
                      ₹{store.upstoxMargin?.used_margin.toLocaleString(undefined, { minimumFractionDigits: 1 }) || '0.0'}
                    </span>
                  </div>
                  <div className="border-l border-zinc-200 pl-3 text-right">
                    <span className="text-[9px] text-zinc-400 block">SYNC REFRESH</span>
                    <button 
                      onClick={triggerManualRefresh}
                      className="text-zinc-500 hover:text-zinc-800 cursor-pointer p-0.5"
                    >
                      <RefreshCw className="w-3 h-3 animate-spin duration-[4000ms]" />
                    </button>
                  </div>
                </div>

                {/* Direct linkage toggler */}
                <div className="flex items-center justify-between border-t border-zinc-150 pt-2 mt-1">
                  <span className="text-[9px] font-mono text-zinc-500">DIRECT SYSTEM FEED LINKAGE:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => store.setUpstoxLiveSync(!store.isUpstoxLiveSynced)}
                      className={`text-[9px] font-mono px-2 py-0.5 rounded cursor-pointer transition-colors font-bold ${
                        store.isUpstoxLiveSynced 
                          ? 'bg-purple-50 text-purple-700 border border-purple-200' 
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                      }`}
                    >
                      {store.isUpstoxLiveSynced ? 'LIVE OVERRIDE ACTIVE' : 'LOCAL SIMULATOR'}
                    </button>
                    <button
                      onClick={store.disconnectUpstox}
                      className="text-[9px] font-mono hover:bg-rose-50 text-rose-600 hover:border-rose-200 px-1.5 py-0.5 border border-transparent rounded cursor-pointer"
                    >
                      DISCONNECT
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Interactive Skills Tester */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          
          {/* Skills Spec Grid */}
          <div className="border border-zinc-200 rounded p-3.5 bg-white text-zinc-800 flex flex-col gap-3">
            <span className="text-[10px] font-extrabold text-zinc-800 font-mono uppercase flex items-center gap-1.5">
              <Code className="w-3.5 h-3.5 text-zinc-550" />
              INTEGRATION SKILLS SPECIFICATION (MODEL SCHEMAS)
            </span>
            <p className="text-[10px] text-zinc-550 leading-relaxed font-mono">
              Below are the standard <b>Upstox Skills</b> built into our toolset matching upstox-skills specification. Click any skill below to run an interactive query against the API proxy!
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {skillsSpec.map((sk) => (
                <div 
                  key={sk.id}
                  className="bg-zinc-50 border border-zinc-200 hover:border-zinc-350 p-2.5 rounded flex flex-col justify-between gap-2.5 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-black text-zinc-800">{sk.name}</span>
                      <span className="text-[9px] font-mono uppercase text-zinc-400 bg-white border border-zinc-200 px-1 py-0.2 rounded font-extrabold">
                        {sk.id}
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-500 font-mono mt-1 leading-relaxed">
                      {sk.description}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t border-zinc-150 pt-2 text-[9px] font-mono">
                    <span className="text-zinc-550 font-bold bg-white border border-zinc-200/80 rounded px-1.5 py-0.2">
                      {sk.method} {sk.endpoint}
                    </span>
                    <button
                      onClick={() => executeSkillDirect(sk.id, sk.endpoint)}
                      className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-950 text-white text-[9px] font-mono font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      TEST SKILL <ArrowRight className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive JSON Terminal Screen */}
          <div className="bg-zinc-900 text-zinc-200 rounded border border-zinc-950 flex flex-col flex-1 min-h-[190px] overflow-hidden shadow-inner">
            <div className="bg-zinc-950 px-3 py-2 border-b border-zinc-900 flex items-center justify-between text-[10px] font-mono text-zinc-400 font-bold">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                UPSTOX API TERMINAL TRANSACTION OUTPUT
              </span>
              <span className="text-[9px] bg-zinc-800/80 px-1.5 py-0.2 rounded">
                STD_STABIL_ENG
              </span>
            </div>
            <div className="flex-1 p-3 font-mono text-[10px] overflow-auto max-h-[160px] leading-relaxed select-text placeholder:text-zinc-550 scrollable-terminal">
              {consoleOutput ? (
                <pre className="text-emerald-400/90 whitespace-pre">{consoleOutput}</pre>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-550 select-none py-4 text-center">
                  <FileJson className="w-5 h-5 mb-1.5 text-zinc-600" />
                  <span>Click "TEST SKILL" or input credential inputs to trigger transaction log.</span>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
