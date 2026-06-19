import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import WebSocket from "ws";

// @ts-ignore
import UpstoxClient from "upstox-js-sdk";

// Workaround for clearSubscriptions private method bug in upstox-js-sdk
if (UpstoxClient && UpstoxClient.MarketDataStreamerV3) {
  Object.defineProperty(UpstoxClient.MarketDataStreamerV3.prototype, 'streamer', {
    configurable: true,
    enumerable: true,
    get() {
      return this._streamerInstance;
    },
    set(val) {
      if (val && !val.clearSubscriptions) {
        val.clearSubscriptions = function() {
          console.log("Safely intercepted and called clearSubscriptions wrapper on internal feeder.");
        };
      }
      this._streamerInstance = val;
    }
  });
}

// @ts-ignore
import MarketDataFeederV3Module from "upstox-js-sdk/dist/feeder/MarketDataFeederV3.js";
if (MarketDataFeederV3Module && MarketDataFeederV3Module.MarketDataFeederV3) {
  MarketDataFeederV3Module.MarketDataFeederV3.prototype.clearSubscriptions = function() {
    console.log("Safe polyfill: MarketDataFeederV3.clearSubscriptions called.");
  };

  // Patch connectWebSocket on the prototype to conditionalize the Authorization header.
  // This is vital because the pre-authorized Redirect URI contains dynamic credentials in query parameters,
  // and sending the raw Authorization Bearer token header to the downstream real-time cluster will crash with a 403 Forbidden.
  MarketDataFeederV3Module.MarketDataFeederV3.prototype.connectWebSocket = async function(wsUrl: string, accessToken?: string) {
    const wsOpts: any = {
      followRedirects: true
    };
    if (accessToken && accessToken !== "undefined" && accessToken.trim() !== "") {
      wsOpts.headers = {
        Authorization: `Bearer ${accessToken}`
      };
    }
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl, wsOpts);
      resolve(ws);
    });
  };

  // Robust custom connection override to fetch the authorized dynamic WebSocket URL first.
  // This avoids a 403 authorization error caused by the SDK attempting to connect direct-to-destination without a redirect path or URL token.
  MarketDataFeederV3Module.MarketDataFeederV3.prototype.connect = async function() {
    // Skip if its already connected or connecting (0 is CONNECTING, 1 is OPEN)
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      console.log("[Upstox Feeder Patch] Connection is already active or establishing. Ignoring redundant connect call.");
      return;
    }

    let wsUrl = "wss://api.upstox.com/v3/feed/market-data-feed";
    let useAuthHeader = true;
    try {
      const token = this.apiClient?.authentications?.["OAUTH2"]?.accessToken;
      if (!token) {
        console.warn("[Upstox Feeder Patch] Connect requested, but accessToken is not set yet in the OAUTH2 client.");
      } else {
        console.log("[Upstox Feeder Patch] Fetching authorized WebSocket redirect URI from Upstox API...");
        const res = await fetch("https://api.upstox.com/v3/feed/market-data-feed/authorize", {
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`
          }
        });
        
        if (res.ok) {
          const json: any = await res.json();
          if (json && json.status === "success" && json.data && json.data.authorizedRedirectUri) {
            wsUrl = json.data.authorizedRedirectUri;
            useAuthHeader = false; // Redirect URI is pre-authorized. DO NOT send the Authorization header.
            console.log("[Upstox Feeder Patch] Received authorized dynamic WS route:", wsUrl);
          } else {
            console.warn("[Upstox Feeder Patch] Unexpected response structure from /v3/feed/market-data-feed/authorize:", json);
          }
        } else {
          const errText = await res.text();
          console.error(`[Upstox Feeder Patch] Feed authorize failed with status ${res.status}:`, errText);
        }
      }
    } catch (err) {
      console.error("[Upstox Feeder Patch] Exception during feed authorize call:", err);
    }

    console.log(`[Upstox Feeder Patch] Initiating WebSocket connection to: ${wsUrl} (useAuthHeader: ${useAuthHeader})`);
    this.ws = await this.connectWebSocket(wsUrl, useAuthHeader ? this.apiClient.authentications["OAUTH2"].accessToken : undefined);
    this.onOpen();
    this.onMessage();
    this.onClose();
    this.onError();
  };
}

// @ts-ignore
import FeederModule from "upstox-js-sdk/dist/feeder/Feeder.js";
if (FeederModule && FeederModule.default) {
  FeederModule.default.prototype.clearSubscriptions = function() {
    console.log("Safe polyfill: Feeder.clearSubscriptions (default) called.");
  };
} else if (FeederModule && FeederModule.Feeder) {
  FeederModule.Feeder.prototype.clearSubscriptions = function() {
    console.log("Safe polyfill: Feeder.clearSubscriptions (named) called.");
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Crucial parse middle layers
  app.use(express.json());

  // WebSocket state tracking
  let activeStreamer: any = null;
  let latestUpstoxState = {
    spotPrice: 0,
    prevSpotPrice: 0,
    lastUpdated: 0,
    ticks: {} as Record<string, { ltp: number; oi: number; volume: number }>,
    wsStatus: "disconnected",
    wsError: null as string | null
  };

  function initializeUpstoxWsStreamer(token: string) {
    if (!token) {
      latestUpstoxState.wsStatus = "disconnected";
      latestUpstoxState.wsError = "Token is missing";
      return;
    }
    let cleanedToken = token.trim();
    if (cleanedToken.toLowerCase().startsWith("bearer ")) {
      cleanedToken = cleanedToken.substring(7).trim();
    }

    if (!cleanedToken || cleanedToken.toLowerCase().includes("mock") || cleanedToken.toLowerCase().includes("sandbox")) {
      console.log("Using mock/sandbox mode. Skipping server-side WS streamer.");
      latestUpstoxState.wsStatus = "sandbox";
      latestUpstoxState.wsError = null;
      return;
    }

    try {
      latestUpstoxState.wsStatus = "connecting";
      latestUpstoxState.wsError = null;

      if (activeStreamer) {
        console.log("Stopping active Upstox dynamic WS feed streamer for reconnection...");
        try {
          activeStreamer.disconnect();
        } catch (disErr) {
          console.warn("Disconnection warning:", disErr);
        }
        activeStreamer = null;
      }

      console.log("Instantiating Upstox OAUTH2 client credentials...");
      let defaultClient = UpstoxClient.ApiClient.instance;
      var OAUTH2 = defaultClient.authentications["OAUTH2"];
      OAUTH2.accessToken = cleanedToken;

      console.log("Starting Upstox MarketDataStreamerV3 WS Client...");
      const streamer = new UpstoxClient.MarketDataStreamerV3();
      activeStreamer = streamer;

      // Enable throttled auto reconnect to prevent rapid reconnect loops (10s intervals, max 3 attempts)
      streamer.autoReconnect(true, 10, 3);

      streamer.connect();

      streamer.on("open", () => {
        console.log("Connected to Upstox MarketDataStreamerV3 feed channel! Subscribing to Nifty index...");
        latestUpstoxState.wsStatus = "connected";
        latestUpstoxState.wsError = null;
        streamer.subscribe(["NSE_INDEX|Nifty 50"], "full");
      });

      streamer.on("message", (data: any) => {
        if (data && data.feeds) {
          let hasChange = false;
          for (const key of Object.keys(data.feeds)) {
            const feedItem = data.feeds[key];
            const ltp = feedItem?.ltpc?.ltp || 
                        feedItem?.ff?.marketFF?.ltpc?.ltp || 
                        feedItem?.ff?.marketFF?.indexFF?.ltpc?.ltp;
            
            const oi = feedItem?.oi || feedItem?.ff?.marketFF?.oi || 0;
            const volume = feedItem?.v || feedItem?.ff?.marketFF?.v || 0;

            if (ltp !== undefined) {
              latestUpstoxState.ticks[key] = { ltp, oi, volume };
              if (key === "NSE_INDEX|Nifty 50") {
                latestUpstoxState.prevSpotPrice = latestUpstoxState.spotPrice || ltp;
                latestUpstoxState.spotPrice = ltp;
              }
              hasChange = true;
            }
          }
          if (hasChange) {
            latestUpstoxState.lastUpdated = Date.now();
          }
        }
      });

      streamer.on("error", (error: any) => {
        console.error("Upstox backend WS feed streamer error:", error);
        const errStr = error?.message || error?.toString() || "WebSocket unauthorized/handshake failed (403)";
        latestUpstoxState.wsError = errStr;

        // Catch Authentication (403/401) or Rate Limit (429) errors so we don't aggressively retry and get blocked
        if (errStr.includes("403") || errStr.includes("401") || errStr.includes("429")) {
          console.warn(`[Upstox WS Feeder] Critical network authorization/rate status code detected (${errStr}). Disabling auto-reconnect to protect credentials.`);
          latestUpstoxState.wsStatus = "error";
          try {
            streamer.autoReconnect(false);
            streamer.disconnect();
          } catch (disErr) {}
          if (activeStreamer === streamer) {
            activeStreamer = null;
          }
        }
      });

      streamer.on("close", () => {
        console.log("Upstox WS streamer connection closed.");
        if (latestUpstoxState.wsStatus !== "disconnected") {
          latestUpstoxState.wsStatus = "disconnected";
        }
      });

    } catch (err: any) {
      console.error("Exception starting Upstox WS state streamer:", err);
      latestUpstoxState.wsStatus = "error";
      latestUpstoxState.wsError = err?.message || err?.toString() || "Server-side exception";
    }
  }

  // Trigger auto initialization on boot if server token exists
  if (process.env.UPSTOX_ACCESS_TOKEN) {
    console.log("Found preconfigured UPSTOX_ACCESS_TOKEN. Launching WebSocket feed on startup.");
    initializeUpstoxWsStreamer(process.env.UPSTOX_ACCESS_TOKEN);
  }

  // API/upstox connect streamer
  app.post("/api/upstox/connect-ws", (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ status: "error", message: "Missing token parameter" });
    }
    console.log("Client requested WebSocket stream connector activation.");
    const cleaned = token.trim();
    process.env.UPSTOX_ACCESS_TOKEN = cleaned;
    initializeUpstoxWsStreamer(cleaned);
    res.json({ status: "success", message: "Upstox WS streamer initialization sequence triggered." });
  });

  // API/upstox dynamic subscribe
  app.post("/api/upstox/subscribe-ws", (req, res) => {
    const { keys } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ status: "error", message: "keys array parameter is required" });
    }
    if (activeStreamer) {
      console.log(`Subscribing WS stream to instruments: ${JSON.stringify(keys)}`);
      try {
        activeStreamer.subscribe(keys, "full");
        res.json({ status: "success", message: "Subscribing request delivered successfully." });
      } catch (err: any) {
        res.status(500).json({ status: "error", message: err.message || err });
      }
    } else {
      res.status(404).json({ status: "error", message: "No active Upstox feed streamer running on backend." });
    }
  });

  // API/upstox-feed getter
  app.get("/api/upstox-feed", (req, res) => {
    res.json({
      status: "success",
      data: {
        spotPrice: latestUpstoxState.spotPrice,
        prevSpotPrice: latestUpstoxState.prevSpotPrice,
        lastUpdated: latestUpstoxState.lastUpdated,
        ticks: latestUpstoxState.ticks,
        wsStatus: latestUpstoxState.wsStatus,
        wsError: latestUpstoxState.wsError
      }
    });
  });

  // API/upstox wildcard proxy
  app.all("/api/upstox/*", async (req, res) => {
    // 1. Recover path suffix robustly
    let rawPath = req.params[0] || req.params["*"] || "";
    if (!rawPath) {
      const prefix = "/api/upstox/";
      if (req.path.startsWith(prefix)) {
        rawPath = req.path.substring(prefix.length);
      }
    }
    
    // Remove leading and trailing slashes to avoid double-slashes or 404s
    rawPath = rawPath.replace(/^\/+|\/+$/g, "");

    // 2. Recover token
    const token = req.headers["authorization"];
    if (!token) {
      return res.status(401).json({
        status: "error",
        errors: [{ message: "Missing Upstox ACCESS_TOKEN in Authorization header" }]
      });
    }

    // 3. Assemble full Upstox API v2 url
    const queryStr = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const upstoxUrl = `https://api.upstox.com/v2/${rawPath}${queryStr}`;

    console.log(`[Upstox Proxy] forwarding ${req.method} request to URL: ${upstoxUrl}`);

    try {
      const fetchHeaders: Record<string, string> = {
        "Authorization": token,
        "Accept": "application/json"
      };

      if (["POST", "PUT", "DELETE"].includes(req.method)) {
        fetchHeaders["Content-Type"] = "application/json";
      }

      const response = await fetch(upstoxUrl, {
        method: req.method,
        headers: fetchHeaders,
        body: ["POST", "PUT", "DELETE"].includes(req.method) ? JSON.stringify(req.body) : undefined
      });

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        return res.status(response.status).json(data);
      } else {
        const textData = await response.text();
        console.warn(`[Upstox Proxy] Non-JSON response received from Upstox (status ${response.status}):`, textData.substring(0, 500));
        return res.status(response.status).send(textData);
      }
    } catch (err: any) {
      console.error("Upstox Proxy System Exception:", err);
      return res.status(500).json({
        status: "error",
        errors: [{ message: `Internal Upstox Gateway Proxy Error: ${err.message || err}` }]
      });
    }
  });

  // Base checking endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
  });

  // Safe server-side environment checks for Upstox credential integration
  app.get("/api/upstox-config", (req, res) => {
    res.json({
      hasToken: !!process.env.UPSTOX_ACCESS_TOKEN,
      upstoxToken: process.env.UPSTOX_ACCESS_TOKEN || ""
    });
  });

  // Vite development vs Production asset serving middlewares
  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite Dev Engine middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving production bundle from dist folder...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express Master Devserver streaming at http://0.0.0.0:${PORT}`);
  });
}

startServer();
