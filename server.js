const express   = require('express');
const fetch     = require('node-fetch');
const cors      = require('cors');
const http      = require('http');
const WebSocket = require('ws');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══ Twelve Data API Key ══
const TD_KEY = process.env.TWELVEDATA_KEY || '86b8177381184a25a749d2d22bda9d2e';

// ══ CORS ══
const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.netlify\.com$/i.test(origin)) return true;
  if (/^http:\/\/localhost:\d+$/i.test(origin)) return true;
  if (/^http:\/\/127\.0\.0\.1:\d+$/i.test(origin)) return true;
  return false;
}

app.use(cors({
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static('public'));

// ══════════════════════════════════════════════════
// Symbol mapping: TradingView → Twelve Data
// ══════════════════════════════════════════════════
const SYMBOL_MAP = {
  // Forex
  'FX:EURUSD':'EUR/USD','FX:GBPUSD':'GBP/USD','FX:USDJPY':'USD/JPY',
  'FX:USDCHF':'USD/CHF','FX:AUDUSD':'AUD/USD','FX:USDCAD':'USD/CAD',
  'FX:NZDUSD':'NZD/USD','FX:EURJPY':'EUR/JPY','FX:GBPJPY':'GBP/JPY',
  'FX:EURGBP':'EUR/GBP','FX:USDTRY':'USD/TRY','FX:USDSAR':'USD/SAR','FX:USDAED':'USD/AED',
  // Metals & Commodities
  'TVC:GOLD':'XAU/USD','TVC:SILVER':'XAG/USD','TVC:PLATINUM':'XPT/USD','TVC:PALLADIUM':'XPD/USD',
  'TVC:USOIL':'WTI/USD','TVC:UKOIL':'BRENT/USD','TVC:NATGAS':'NATGAS/USD','TVC:COPPER':'COPPER/USD',
  // Crypto
  'COINBASE:BTCUSD':'BTC/USD','COINBASE:ETHUSD':'ETH/USD','COINBASE:SOLUSD':'SOL/USD',
  'COINBASE:XRPUSD':'XRP/USD','BINANCE:BNBUSDT':'BNB/USD','COINBASE:ADAUSD':'ADA/USD',
  'COINBASE:DOGEUSD':'DOGE/USD','COINBASE:AVAXUSD':'AVAX/USD','COINBASE:LINKUSD':'LINK/USD',
  // Stocks
  'NASDAQ:AAPL':'AAPL','NASDAQ:MSFT':'MSFT','NASDAQ:TSLA':'TSLA','NASDAQ:NVDA':'NVDA',
  'NASDAQ:META':'META','NASDAQ:AMZN':'AMZN','NASDAQ:GOOGL':'GOOGL','NASDAQ:NFLX':'NFLX',
  'NASDAQ:AMD':'AMD','NASDAQ:INTC':'INTC','NYSE:BABA':'BABA','NYSE:JPM':'JPM','NYSE:GS':'GS',
  // Indices
  'TVC:SPX':'SPX','TVC:DJI':'DJI','TVC:NDX':'NDX','TVC:VIX':'VIX',
  'TVC:UK100':'UK100','TVC:DEU40':'DAX','TVC:FRA40':'CAC40',
  'TVC:JPN225':'NIKKEI','TVC:HSI':'HSI','TVC:AUS200':'AUS200','TVC:EU50':'EU50',
};

const REVERSE_MAP = {};
Object.entries(SYMBOL_MAP).forEach(([tv, td]) => { if (!REVERSE_MAP[td]) REVERSE_MAP[td] = tv; });

const ALL_TV = Object.keys(SYMBOL_MAP);
const ALL_TD = [...new Set(Object.values(SYMBOL_MAP))];

// ══ Cache & SSE clients ══
const cache     = {}; // tvSym → { price, open, ts }
let lastUpdate  = 0;
let tdConnected = false;
const sseClients = new Set();

// ══════════════════════════════════════════════════
// Twelve Data WebSocket — ONE connection for server
// Pushes updates to all SSE clients immediately
// ══════════════════════════════════════════════════
let tdWS = null;

function connectTwelveDataWS() {
  if (tdWS) { try { tdWS.terminate(); } catch(e) {} tdWS = null; }

  console.log('🔌 Connecting to Twelve Data WebSocket...');
  tdWS = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TD_KEY}`);

  tdWS.on('open', () => {
    tdConnected = true;
    console.log('✅ Twelve Data WS connected');
    tdWS.send(JSON.stringify({ action: 'subscribe', params: { symbols: ALL_TD.join(',') } }));
    console.log(`📊 Subscribed to ${ALL_TD.length} symbols`);
  });

  tdWS.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.event === 'price') {
        const price = parseFloat(msg.price);
        if (!msg.symbol || !price || isNaN(price)) return;
        const tvSym = REVERSE_MAP[msg.symbol];
        if (!tvSym) return;

        const open = cache[tvSym]?.open || price;
        cache[tvSym] = { price, open, ts: Date.now() };
        lastUpdate   = Date.now();

        // Push to all SSE clients
        const payload = `data: ${JSON.stringify({ symbol: tvSym, price, open, ts: Date.now() })}\n\n`;
        sseClients.forEach(res => {
          try { res.write(payload); } catch(e) { sseClients.delete(res); }
        });
      }

      if (msg.event === 'heartbeat') console.log('💓 heartbeat');
      if (msg.event === 'subscribe-status' && msg.status !== 'ok') {
        console.warn(`⚠️ Subscribe issue: ${msg.symbol} — ${msg.message}`);
      }
    } catch(e) {}
  });

  tdWS.on('close', () => {
    tdConnected = false;
    console.warn('⚠️ WS closed — reconnecting in 5s...');
    setTimeout(connectTwelveDataWS, 5000);
  });

  tdWS.on('error', (err) => {
    tdConnected = false;
    console.error('❌ WS error:', err.message);
  });
}

connectTwelveDataWS();

// ══════════════════════════════════════════════════
// REST snapshot — warm up cache on startup
// ══════════════════════════════════════════════════
async function fetchSnapshot(tdSymbols) {
  const url  = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSymbols.join(','))}&apikey=${TD_KEY}`;
  try {
    const data = await fetch(url, { timeout: 15000 }).then(r => r.json());
    if (!data) return;

    if (tdSymbols.length === 1 && data.price) {
      const price = parseFloat(data.price);
      const tvSym = REVERSE_MAP[tdSymbols[0]];
      if (tvSym && price > 0) cache[tvSym] = { price, open: cache[tvSym]?.open || price, ts: Date.now() };
      return;
    }

    Object.entries(data).forEach(([tdSym, obj]) => {
      const price = parseFloat(obj?.price);
      const tvSym = REVERSE_MAP[tdSym];
      if (tvSym && price > 0) cache[tvSym] = { price, open: cache[tvSym]?.open || price, ts: Date.now() };
    });

    lastUpdate = Date.now();
  } catch(e) { console.warn('Snapshot error:', e.message); }
}

async function warmUp() {
  for (let i = 0; i < ALL_TD.length; i += 50) {
    await fetchSnapshot(ALL_TD.slice(i, i + 50));
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(`✅ Cache ready — ${Object.keys(cache).length}/${ALL_TV.length} symbols`);
}

warmUp();

// Backup REST refresh every 60s for any missed symbols
setInterval(async () => {
  const stale = ALL_TV.filter(tv => !cache[tv] || Date.now() - cache[tv].ts > 120000);
  if (stale.length) {
    const tdSyms = [...new Set(stale.map(tv => SYMBOL_MAP[tv]))];
    for (let i = 0; i < tdSyms.length; i += 50) {
      await fetchSnapshot(tdSyms.slice(i, i + 50));
      await new Promise(r => setTimeout(r, 400));
    }
  }
}, 60000);

// ══════════════════════════════════════════════════
// SSE /stream — real-time prices to browser
// ══════════════════════════════════════════════════
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type',       'text/event-stream');
  res.setHeader('Cache-Control',      'no-cache');
  res.setHeader('Connection',         'keep-alive');
  res.setHeader('X-Accel-Buffering',  'no');
  res.flushHeaders();

  // Send full snapshot on connect
  const snapshot = {};
  Object.entries(cache).forEach(([tv, d]) => { snapshot[tv] = { price: d.price, open: d.open, ts: d.ts }; });
  res.write(`data: ${JSON.stringify({ type: 'snapshot', prices: snapshot })}\n\n`);

  sseClients.add(res);
  console.log(`📡 SSE connected — clients: ${sseClients.size}`);

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch(e) { clearInterval(ping); } }, 25000);
  req.on('close', () => { sseClients.delete(res); clearInterval(ping); console.log(`📡 SSE disconnected — clients: ${sseClients.size}`); });
});

// ══════════════════════════════════════════════════
// REST endpoints
// ══════════════════════════════════════════════════
app.get('/', (req, res) => res.json({
  ok: true, service: 'SAB Invest — Twelve Data',
  symbols: ALL_TV.length, cached: Object.keys(cache).length,
  wsConnected: tdConnected, sseClients: sseClients.size,
  endpoints: ['/health','/prices','/price?symbol=TVC:GOLD','/batch?symbols=NASDAQ:AAPL,TVC:GOLD','/stream']
}));

app.get('/health', (req, res) => res.json({
  ok: true, uptime: process.uptime(),
  wsConnected: tdConnected, cached: Object.keys(cache).length,
  sseClients: sseClients.size, lastUpdate, ts: Date.now()
}));

app.get('/prices', (req, res) => {
  const out = {};
  ALL_TV.forEach(tv => { const c = cache[tv]; if (c?.price) out[tv] = { price: c.price, open: c.open, ts: c.ts }; });
  res.json({ prices: out, count: Object.keys(out).length, lastUpdate, ts: Date.now() });
});

app.get('/price', async (req, res) => {
  const tvSym = req.query.symbol;
  if (!tvSym) return res.status(400).json({ error: 'No symbol' });
  const tdSym = SYMBOL_MAP[tvSym];
  if (!tdSym) return res.status(404).json({ error: 'Unknown symbol: ' + tvSym });
  const c = cache[tvSym];
  if (c?.price && Date.now() - c.ts < 30000) return res.json({ symbol: tvSym, price: c.price, open: c.open, ts: c.ts });
  await fetchSnapshot([tdSym]);
  const fresh = cache[tvSym];
  if (fresh?.price) return res.json({ symbol: tvSym, price: fresh.price, open: fresh.open, ts: fresh.ts });
  res.status(503).json({ error: 'Price unavailable', symbol: tvSym });
});

app.get('/batch', async (req, res) => {
  const tvList  = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
  const out     = {};
  const missing = [];
  tvList.forEach(tv => { const c = cache[tv]; if (c?.price) out[tv] = { price: c.price, open: c.open, ts: c.ts }; else missing.push(tv); });
  if (missing.length) {
    const tdSyms = missing.map(tv => SYMBOL_MAP[tv]).filter(Boolean);
    if (tdSyms.length) { await fetchSnapshot(tdSyms); missing.forEach(tv => { const c = cache[tv]; if (c?.price) out[tv] = { price: c.price, open: c.open, ts: c.ts }; }); }
  }
  res.json({ prices: out, count: Object.keys(out).length, ts: Date.now() });
});

// ══ Start ══
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`✅ SAB Invest (Twelve Data) on port ${PORT}`);
  console.log(`📊 ${ALL_TV.length} symbols | 📡 SSE /stream | 🔑 Key: ${TD_KEY.slice(0,8)}...`);
})