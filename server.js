const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Twelve Data API key.
// Best practice on Render: add TWELVEDATA_API_KEY in Environment Variables.
const TD_KEY = process.env.TWELVEDATA_API_KEY || '86b8177381184a25a749d2d22bda9d2e';

// Frontend CORS: Netlify + localhost are allowed by default.
// You can also set FRONTEND_URLS=https://your-site.netlify.app,http://localhost:3000
const allowedOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.static('public'));

// TradingView/dashboard symbol -> Twelve Data symbol.
// Add more symbols here whenever you add rows to the dashboard watchlist.
const SYMBOL_MAP = {
  'FX:EURUSD': 'EUR/USD',
  'FX:GBPUSD': 'GBP/USD',
  'FX:USDJPY': 'USD/JPY',
  'FX:USDCHF': 'USD/CHF',
  'FX:AUDUSD': 'AUD/USD',
  'FX:USDCAD': 'USD/CAD',
  'FX:NZDUSD': 'NZD/USD',
  'FX:EURJPY': 'EUR/JPY',
  'FX:GBPJPY': 'GBP/JPY',
  'FX:EURGBP': 'EUR/GBP',
  'FX:USDTRY': 'USD/TRY',
  'FX:USDSAR': 'USD/SAR',
  'FX:USDAED': 'USD/AED',
  'FX:USDCNH': 'USD/CNH',
  'FX:USDMXN': 'USD/MXN',
  'FX:EURCHF': 'EUR/CHF',
  'FX:AUDJPY': 'AUD/JPY',
  'FX:CADJPY': 'CAD/JPY',
  'FX:CHFJPY': 'CHF/JPY',
  'FX:GBPCHF': 'GBP/CHF',
  'FX:EURAUD': 'EUR/AUD',
  'COINBASE:BTCUSD': 'BTC/USD',
  'COINBASE:ETHUSD': 'ETH/USD',
  'COINBASE:SOLUSD': 'SOL/USD',
  'COINBASE:XRPUSD': 'XRP/USD',
  'BINANCE:BNBUSDT': 'BNB/USD',
  'COINBASE:ADAUSD': 'ADA/USD',
  'COINBASE:DOGEUSD': 'DOGE/USD',
  'COINBASE:AVAXUSD': 'AVAX/USD',
  'COINBASE:LINKUSD': 'LINK/USD',
  'COINBASE:LTCUSD': 'LTC/USD',
  'COINBASE:DOTUSD': 'DOT/USD',
  'COINBASE:MATICUSD': 'MATIC/USD',
  'COINBASE:UNIUSD': 'UNI/USD',
  'COINBASE:AAVEUSD': 'AAVE/USD',
  'COINBASE:BCHUSD': 'BCH/USD',
  'BINANCE:TRXUSDT': 'TRX/USD',
  'TVC:GOLD': 'XAU/USD',
  'TVC:SILVER': 'XAG/USD',
  'TVC:PLATINUM': 'XPT/USD',
  'TVC:PALLADIUM': 'XPD/USD',
  'TVC:USOIL': 'WTI/USD',
  'TVC:UKOIL': 'BRENT/USD',
  'TVC:NATGAS': 'NATURALGAS/USD',
  'TVC:COPPER': 'COPPER/USD',
  'ICEUS:KC1!': 'COFFEE/USD',
  'ICEUS:CC1!': 'COCOA/USD',
  'ICEUS:SB1!': 'SUGAR/USD',
  'CBOT:ZC1!': 'CORN/USD',
  'CBOT:ZW1!': 'WHEAT/USD',
  'CBOT:ZS1!': 'SOYBEAN/USD',
  'ICEUS:CT1!': 'COTTON/USD',
  'NYMEX:RB1!': 'GASOLINE/USD',
  'TVC:DJI': 'DJI',
  'TVC:SPX': 'SPX',
  'TVC:NDX': 'NDX',
  'TVC:VIX': 'VIX',
  'TVC:RUT': 'RUT',
  'TVC:UK100': 'FTSE',
  'TVC:DEU40': 'DAX',
  'TVC:FRA40': 'CAC',
  'TVC:JPN225': 'NIKKEI',
  'TVC:AUS200': 'ASX200',
  'TVC:HSI': 'HSI',
  'TVC:EU50': 'SX5E',
  'TSX:TSX': 'TSX',
  'KRX:KOSPI': 'KOSPI',
  'BME:IBC': 'IBEX',
  'BSE:SENSEX': 'SENSEX',
  'NASDAQ:AAPL': 'AAPL',
  'NASDAQ:MSFT': 'MSFT',
  'NASDAQ:TSLA': 'TSLA',
  'NASDAQ:NVDA': 'NVDA',
  'NASDAQ:META': 'META',
  'NASDAQ:AMZN': 'AMZN',
  'NASDAQ:GOOGL': 'GOOGL',
  'NASDAQ:NFLX': 'NFLX',
  'NASDAQ:AMD': 'AMD',
  'NASDAQ:INTC': 'INTC',
  'NYSE:BABA': 'BABA',
  'NYSE:JPM': 'JPM',
  'NYSE:GS': 'GS',
  'NYSE:V': 'V',
  'NYSE:MA': 'MA',
  'NASDAQ:PYPL': 'PYPL',
  'NYSE:CRM': 'CRM',
  'NYSE:ORCL': 'ORCL',
  'NYSE:IBM': 'IBM',
  'NASDAQ:QCOM': 'QCOM',
  'NASDAQ:AVGO': 'AVGO',
  'NASDAQ:COST': 'COST',
  'NYSE:DIS': 'DIS',
  'NYSE:BA': 'BA',
  'NYSE:WMT': 'WMT',
  'NYSE:PFE': 'PFE',
  'NYSE:KO': 'KO',
  'NYSE:MCD': 'MCD',
  'NYSE:NKE': 'NKE',
  'NYSE:UBER': 'UBER',
};

const REVERSE_MAP = Object.fromEntries(Object.entries(SYMBOL_MAP).map(([tv, td]) => [td, tv]));
const ALL_TV = Object.keys(SYMBOL_MAP);
const ALL_TD = [...new Set(Object.values(SYMBOL_MAP))];
// Grow plan has limited trial WebSocket streams. Keep WS to 8 priority symbols; REST updates all 70+ markets.
const WS_PRIORITY_TD = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "BTC/USD", "ETH/USD", "AAPL", "TSLA"];

let cache = {}; // tvSym -> { price, open, ts, tdSymbol }
let lastUpdate = 0;
let updating = false;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function tdToTvSymbol(tdSymbol) {
  if (!tdSymbol) return null;
  if (REVERSE_MAP[tdSymbol]) return REVERSE_MAP[tdSymbol];

  const clean = String(tdSymbol).replace(':CUR', '').replace(':FOREX', '').trim().toUpperCase();
  const direct = Object.entries(SYMBOL_MAP).find(([, td]) => td.toUpperCase() === clean);
  if (direct) return direct[0];

  const noSlash = clean.replace('/', '');
  const fuzzy = Object.entries(SYMBOL_MAP).find(([, td]) => td.toUpperCase().replace('/', '') === noSlash);
  return fuzzy ? fuzzy[0] : null;
}

function setCache(tvSym, price, extra = {}) {
  const num = Number(price);
  if (!tvSym || !num || Number.isNaN(num) || num <= 0) return false;
  cache[tvSym] = {
    price: num,
    open: Number(extra.open) || cache[tvSym]?.open || num,
    high: Number(extra.high) || undefined,
    low: Number(extra.low) || undefined,
    ts: Date.now(),
    tdSymbol: SYMBOL_MAP[tvSym],
  };
  return true;
}

async function fetchTwelvePrice(tdSymbols) {
  if (!TD_KEY) throw new Error('TWELVEDATA_API_KEY is missing');
  const symbols = Array.isArray(tdSymbols) ? tdSymbols : [tdSymbols];
  const url = 'https://api.twelvedata.com/price?symbol=' +
    encodeURIComponent(symbols.join(',')) +
    '&apikey=' + encodeURIComponent(TD_KEY);

  const res = await fetch(url, { timeout: 12000 });
  const data = await res.json();

  const out = {};
  if (symbols.length === 1 && data && data.price) {
    out[symbols[0]] = { price: Number(data.price) };
    return out;
  }

  Object.entries(data || {}).forEach(([tdSym, obj]) => {
    if (obj && obj.price) out[tdSym] = { price: Number(obj.price) };
  });
  return out;
}

async function refreshAll() {
  if (updating) return;
  updating = true;
  let updated = 0;

  try {
    // Twelve Data batch size is kept conservative to avoid provider limits.
    const chunks = chunkArray(ALL_TD, 8);
    for (const chunk of chunks) {
      try {
        const prices = await fetchTwelvePrice(chunk);
        Object.entries(prices).forEach(([tdSym, obj]) => {
          const tvSym = tdToTvSymbol(tdSym);
          if (tvSym && setCache(tvSym, obj.price)) updated++;
        });
      } catch (e) {
        console.warn('Twelve Data chunk failed:', chunk.join(','), e.message);
      }
      await sleep(250);
    }
  } catch (e) {
    console.error('refreshAll error:', e.message);
  }

  lastUpdate = Date.now();
  updating = false;
  console.log(`✅ Twelve Data REST: ${updated} symbols updated — ${new Date().toISOString()}`);
  if (updated) broadcastSSE({ type: 'snapshot', prices: cache, provider: 'Twelve Data REST', ts: Date.now() });
}

refreshAll();
setInterval(refreshAll, 15000);

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'SAB Invest backend',
    provider: 'Twelve Data',
    endpoints: ['/health', '/prices', '/stream', '/price?symbol=TVC:GOLD', '/batch?symbols=NASDAQ:AAPL,TVC:GOLD', '/ws'],
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, provider: 'Twelve Data', uptime: process.uptime(), ts: Date.now() });
});

app.get('/prices', (req, res) => {
  res.json({ prices: cache, count: Object.keys(cache).length, lastUpdate, ts: Date.now() });
});

app.get('/price', async (req, res) => {
  const tvSym = req.query.symbol;
  if (!tvSym) return res.status(400).json({ error: 'No symbol' });

  const tdSym = SYMBOL_MAP[tvSym];
  if (!tdSym) return res.status(404).json({ error: 'Unknown symbol', symbol: tvSym });

  const c = cache[tvSym];
  if (c && Date.now() - c.ts < 20000) {
    return res.json({ symbol: tvSym, price: c.price, open: c.open, ts: c.ts, provider: 'Twelve Data' });
  }

  try {
    const result = await fetchTwelvePrice(tdSym);
    const price = result[tdSym]?.price;
    if (setCache(tvSym, price)) {
      const fresh = cache[tvSym];
      return res.json({ symbol: tvSym, price: fresh.price, open: fresh.open, ts: fresh.ts, provider: 'Twelve Data' });
    }
  } catch (e) {
    return res.status(503).json({ error: 'Price unavailable', symbol: tvSym, details: e.message });
  }

  res.status(503).json({ error: 'Price unavailable', symbol: tvSym });
});

app.get('/batch', async (req, res) => {
  const tvList = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!tvList.length) return res.json({ prices: {}, count: 0, ts: Date.now() });

  const out = {};
  const missing = [];

  tvList.forEach(tvSym => {
    const c = cache[tvSym];
    if (c && Date.now() - c.ts < 20000) out[tvSym] = c;
    else if (SYMBOL_MAP[tvSym]) missing.push(tvSym);
  });

  const tdMissing = missing.map(tv => SYMBOL_MAP[tv]);
  for (const chunk of chunkArray(tdMissing, 8)) {
    try {
      const prices = await fetchTwelvePrice(chunk);
      Object.entries(prices).forEach(([tdSym, obj]) => {
        const tvSym = tdToTvSymbol(tdSym);
        if (tvSym && setCache(tvSym, obj.price)) out[tvSym] = cache[tvSym];
      });
    } catch (e) {
      console.warn('Batch fetch failed:', e.message);
    }
  }

  res.json({ prices: out, count: Object.keys(out).length, ts: Date.now(), provider: 'Twelve Data' });
});


// Server-Sent Events stream for Netlify dashboard.
// Sends initial snapshot and then broadcasts price updates to all connected browsers.
const sseClients = new Set();

function sendSSE(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch(e) {}
}

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
  });
  sendSSE(res, { type: 'snapshot', prices: cache, provider: 'Twelve Data', ts: Date.now() });
  sseClients.add(res);
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch(e) {}
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

function broadcastSSE(obj) {
  sseClients.forEach(res => sendSSE(res, obj));
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

let tdWS = null;
let tdConnected = false;
let reconnectTimer = null;

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
  broadcastSSE(obj);
}

function connectTwelveWS() {
  if (!TD_KEY) return;
  if (tdWS && (tdWS.readyState === WebSocket.OPEN || tdWS.readyState === WebSocket.CONNECTING)) return;

  tdWS = new WebSocket('wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(TD_KEY));

  tdWS.on('open', () => {
    tdConnected = true;
    const symbols = WS_PRIORITY_TD.join(',');
    tdWS.send(JSON.stringify({ action: 'subscribe', params: { symbols } }));
    console.log(`✅ Twelve Data WS subscribed to ${WS_PRIORITY_TD.length} priority symbols; REST covers ${ALL_TD.length} symbols`);
  });

  tdWS.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'price' || (msg.symbol && msg.price)) {
        const tvSym = tdToTvSymbol(msg.symbol);
        const price = Number(msg.price);
        if (tvSym && setCache(tvSym, price)) {
          broadcast({ type: 'prices', data: [{ tvSym, price, ts: Date.now(), provider: 'Twelve Data' }] });
        }
      }

      if (Array.isArray(msg.data)) {
        const processed = [];
        msg.data.forEach(item => {
          const tvSym = tdToTvSymbol(item.symbol);
          const price = Number(item.price);
          if (tvSym && setCache(tvSym, price)) processed.push({ tvSym, price, ts: Date.now(), provider: 'Twelve Data' });
        });
        if (processed.length) broadcast({ type: 'prices', data: processed });
      }

      if (msg.event === 'subscribe-status' && msg.status === 'error') {
        console.warn('Twelve Data subscribe error:', msg);
      }
    } catch (e) {}
  });

  tdWS.on('close', () => {
    tdConnected = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectTwelveWS, 5000);
  });

  tdWS.on('error', err => {
    console.warn('Twelve Data WS error:', err.message);
  });
}

connectTwelveWS();

wss.on('connection', clientWS => {
  console.log('Client WebSocket connected');

  clientWS.send(JSON.stringify({ type: 'snapshot', prices: cache, provider: 'Twelve Data', ts: Date.now() }));
  if (!tdConnected) connectTwelveWS();

  clientWS.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`✅ SAB Invest backend running on port ${PORT}`);
  console.log(`📊 Provider: Twelve Data`);
  console.log(`📈 ${ALL_TV.length} dashboard symbols tracked`);
  console.log(`🔌 WebSocket available at /ws`);
  console.log(`🌐 Allowed frontend origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'localhost + *.netlify.app'}`);
});
