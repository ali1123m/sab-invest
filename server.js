const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const http    = require('http');
const WebSocket = require('ws');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══ Finnhub API Key ══
const FH_KEY = process.env.FINNHUB_KEY || 'd7tjtkhr01qlbd3kf4dgd7tjtkhr01qlbd3kf4e0';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// ══════════════════════════════════════════════════
// Symbol mapping: TV symbol → Finnhub symbol
// ══════════════════════════════════════════════════
const SYMBOL_MAP = {
  // Forex — Finnhub uses OANDA:XXX_YYY format
  'FX:EURUSD':'OANDA:EUR_USD','FX:GBPUSD':'OANDA:GBP_USD','FX:USDJPY':'OANDA:USD_JPY',
  'FX:USDCHF':'OANDA:USD_CHF','FX:AUDUSD':'OANDA:AUD_USD','FX:USDCAD':'OANDA:USD_CAD',
  'FX:NZDUSD':'OANDA:NZD_USD','FX:EURJPY':'OANDA:EUR_JPY','FX:GBPJPY':'OANDA:GBP_JPY',
  'FX:EURGBP':'OANDA:EUR_GBP','FX:USDTRY':'OANDA:USD_TRY','FX:USDSAR':'OANDA:USD_SAR',
  'FX:USDAED':'OANDA:USD_AED',
  // Metals & Commodities
  'TVC:GOLD':'OANDA:XAU_USD','TVC:SILVER':'OANDA:XAG_USD',
  'TVC:USOIL':'OANDA:BCO_USD','TVC:UKOIL':'OANDA:BCO_USD',
  // Crypto — Finnhub uses BINANCE:BTCUSDT
  'COINBASE:BTCUSD':'BINANCE:BTCUSDT','COINBASE:ETHUSD':'BINANCE:ETHUSDT',
  'COINBASE:SOLUSD':'BINANCE:SOLUSDT','COINBASE:XRPUSD':'BINANCE:XRPUSDT',
  'BINANCE:BNBUSDT':'BINANCE:BNBUSDT','COINBASE:ADAUSD':'BINANCE:ADAUSDT',
  'COINBASE:DOGEUSD':'BINANCE:DOGEUSDT','COINBASE:AVAXUSD':'BINANCE:AVAXUSDT',
  'COINBASE:LINKUSD':'BINANCE:LINKUSDT',
  // Stocks
  'NASDAQ:AAPL':'AAPL','NASDAQ:MSFT':'MSFT','NASDAQ:TSLA':'TSLA','NASDAQ:NVDA':'NVDA',
  'NASDAQ:META':'META','NASDAQ:AMZN':'AMZN','NASDAQ:GOOGL':'GOOGL','NASDAQ:NFLX':'NFLX',
  'NASDAQ:AMD':'AMD','NASDAQ:INTC':'INTC','NYSE:BABA':'BABA','NYSE:JPM':'JPM','NYSE:GS':'GS',
  // Indices
  'TVC:SPX':'^GSPC','TVC:DJI':'^DJI','TVC:NDX':'^NDX','TVC:VIX':'^VIX',
  'TVC:UK100':'^FTSE','TVC:DEU40':'^GDAXI','TVC:FRA40':'^FCHI',
  'TVC:JPN225':'^N225','TVC:HSI':'^HSI',
};

const REVERSE_MAP = Object.fromEntries(Object.entries(SYMBOL_MAP).map(([tv,fh])=>[fh,tv]));
const ALL_TV = Object.keys(SYMBOL_MAP);

// ══ In-memory cache ══
let cache = {};        // fhSym → { price, open, ts }
let lastUpdate = 0;
let updating = false;

// ── Fetch single Finnhub quote ──
async function fhQuote(fhSym) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(fhSym)}&token=${FH_KEY}`;
  try {
    const data = await fetch(url, { timeout: 8000 }).then(r => r.json());
    if (data && data.c && data.c > 0) {
      return { price: data.c, open: data.o || data.pc, high: data.h, low: data.l };
    }
  } catch(e) {}
  return null;
}

// ── Fetch forex rates batch (more efficient) ──
async function fhForexRates() {
  const url = `https://finnhub.io/api/v1/forex/rates?base=USD&token=${FH_KEY}`;
  try {
    const data = await fetch(url, { timeout: 8000 }).then(r => r.json());
    if (!data || !data.quote) return {};
    const rates = data.quote;
    const result = {};
    // Build prices from USD base rates
    const usdRates = rates; // rates are vs USD

    const fxMap = {
      'OANDA:EUR_USD': rates.EUR ? 1/rates.EUR : null,
      'OANDA:GBP_USD': rates.GBP ? 1/rates.GBP : null,
      'OANDA:USD_JPY': rates.JPY || null,
      'OANDA:USD_CHF': rates.CHF || null,
      'OANDA:AUD_USD': rates.AUD ? 1/rates.AUD : null,
      'OANDA:USD_CAD': rates.CAD || null,
      'OANDA:NZD_USD': rates.NZD ? 1/rates.NZD : null,
      'OANDA:USD_TRY': rates.TRY || null,
      'OANDA:USD_SAR': rates.SAR || null,
      'OANDA:USD_AED': rates.AED || null,
    };
    // Cross rates
    if (rates.EUR && rates.JPY) fxMap['OANDA:EUR_JPY'] = (1/rates.EUR) * rates.JPY;
    if (rates.GBP && rates.JPY) fxMap['OANDA:GBP_JPY'] = (1/rates.GBP) * rates.JPY;
    if (rates.EUR && rates.GBP) fxMap['OANDA:EUR_GBP'] = rates.GBP / rates.EUR;

    Object.entries(fxMap).forEach(([fhSym, price]) => {
      if (price && !isNaN(price)) result[fhSym] = price;
    });
    return result;
  } catch(e) { return {}; }
}

// ── Main refresh function ──
async function refreshAll() {
  if (updating) return;
  updating = true;
  const now = Date.now();
  let updated = 0;

  try {
    // 1. Forex batch (efficient — one call for all pairs)
    const fxPrices = await fhForexRates();
    Object.entries(fxPrices).forEach(([fhSym, price]) => {
      cache[fhSym] = { price, open: price, ts: now };
      updated++;
    });

    // 2. Stocks & Crypto — individual quotes
    // Group: stocks
    const stocks = ['AAPL','MSFT','TSLA','NVDA','META','AMZN','GOOGL','NFLX','AMD','INTC','BABA','JPM','GS'];
    for (const sym of stocks) {
      const q = await fhQuote(sym);
      if (q) { cache[sym] = { ...q, ts: now }; updated++; }
      await new Promise(r => setTimeout(r, 100)); // small delay
    }

    // 3. Metals
    for (const fhSym of ['OANDA:XAU_USD', 'OANDA:XAG_USD']) {
      const q = await fhQuote(fhSym);
      if (q) { cache[fhSym] = { ...q, ts: now }; updated++; }
      await new Promise(r => setTimeout(r, 100));
    }

    // 4. Crypto
    const cryptos = ['BINANCE:BTCUSDT','BINANCE:ETHUSDT','BINANCE:SOLUSDT','BINANCE:XRPUSDT',
                     'BINANCE:BNBUSDT','BINANCE:ADAUSDT','BINANCE:DOGEUSDT','BINANCE:AVAXUSDT','BINANCE:LINKUSDT'];
    for (const sym of cryptos) {
      const q = await fhQuote(sym);
      if (q) { cache[sym] = { ...q, ts: now }; updated++; }
      await new Promise(r => setTimeout(r, 80));
    }

    // 5. Indices
    for (const fhSym of ['^GSPC','^DJI','^NDX','^VIX','^FTSE','^GDAXI','^FCHI','^N225','^HSI']) {
      const q = await fhQuote(fhSym);
      if (q) { cache[fhSym] = { ...q, ts: now }; updated++; }
      await new Promise(r => setTimeout(r, 100));
    }

  } catch(e) { console.error('refreshAll error:', e.message); }

  lastUpdate = Date.now();
  updating = false;
  console.log(`✅ Finnhub: ${updated} symbols updated — ${new Date().toISOString()}`);
}

// Refresh every 15 seconds (Finnhub free: 60 req/min)
refreshAll();
setInterval(refreshAll, 15000);

// ── Health check ──
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/Dashboard.html');
});ss
// ══════════════════════════════════════════════════
// GET /prices — all symbols at once
// ══════════════════════════════════════════════════
app.get('/prices', (req, res) => {
  const out = {};
  ALL_TV.forEach(tvSym => {
    const fhSym = SYMBOL_MAP[tvSym];
    const c = cache[fhSym];
    if (c && c.price) out[tvSym] = { price: c.price, open: c.open, ts: c.ts };
  });
  res.json({ prices: out, count: Object.keys(out).length, lastUpdate, ts: Date.now() });
});

// ══════════════════════════════════════════════════
// GET /price?symbol=TVC:GOLD — single symbol
// ══════════════════════════════════════════════════
app.get('/price', async (req, res) => {
  const tvSym = req.query.symbol;
  if (!tvSym) return res.status(400).json({ error: 'No symbol' });
  const fhSym = SYMBOL_MAP[tvSym];
  if (!fhSym) return res.status(404).json({ error: 'Unknown symbol' });

  const c = cache[fhSym];
  if (c && Date.now() - c.ts < 20000) {
    return res.json({ symbol: tvSym, price: c.price, open: c.open, ts: c.ts });
  }

  // Fresh fetch
  const q = await fhQuote(fhSym);
  if (q) {
    cache[fhSym] = { ...q, ts: Date.now() };
    return res.json({ symbol: tvSym, price: q.price, open: q.open, ts: Date.now() });
  }

  res.status(503).json({ error: 'Price unavailable', symbol: tvSym });
});

// ══════════════════════════════════════════════════
// GET /batch?symbols=TVC:GOLD,NASDAQ:AAPL
// ══════════════════════════════════════════════════
app.get('/batch', async (req, res) => {
  const tvList = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const tvSym of tvList) {
    const fhSym = SYMBOL_MAP[tvSym];
    if (!fhSym) continue;
    const c = cache[fhSym];
    if (c && c.price) {
      out[tvSym] = { price: c.price, open: c.open, ts: c.ts };
    } else {
      const q = await fhQuote(fhSym);
      if (q) { cache[fhSym] = { ...q, ts: Date.now() }; out[tvSym] = { price: q.price, ts: Date.now() }; }
    }
  }
  res.json({ prices: out, count: Object.keys(out).length, ts: Date.now() });
});

// ══════════════════════════════════════════════════
// WebSocket proxy — forwards Finnhub WS to browser
// Connects to Finnhub WS and subscribes to requested symbols
// ══════════════════════════════════════════════════
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWS) => {
  console.log('Client WebSocket connected');

  // Connect to Finnhub WebSocket
  const fhWS = new WebSocket(`wss://ws.finnhub.io?token=${FH_KEY}`);

  fhWS.on('open', () => {
    // Subscribe to all symbols
    const fhSymbols = [...new Set(Object.values(SYMBOL_MAP))];
    fhSymbols.forEach(sym => {
      fhWS.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
    });
    console.log(`Finnhub WS: subscribed to ${fhSymbols.length} symbols`);
  });

  fhWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'trade' && msg.data) {
        // Convert Finnhub symbol back to TV symbol and forward
        const processed = msg.data.map(trade => {
          const tvSym = REVERSE_MAP[trade.s];
          if (!tvSym) return null;
          // Update cache
          if (!cache[trade.s]) cache[trade.s] = {};
          cache[trade.s].price = trade.p;
          cache[trade.s].ts = Date.now();
          return { tvSym, price: trade.p, ts: trade.t };
        }).filter(Boolean);

        if (processed.length && clientWS.readyState === WebSocket.OPEN) {
          clientWS.send(JSON.stringify({ type: 'prices', data: processed }));
        }
      }
    } catch(e) {}
  });

  fhWS.on('close', () => { if (clientWS.readyState === WebSocket.OPEN) clientWS.close(); });
  fhWS.on('error', () => {});

  clientWS.on('close', () => { try { fhWS.close(); } catch(e) {} });
  clientWS.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`✅ SAB Invest (Finnhub) running on port ${PORT}`);
  console.log(`📊 ${ALL_TV.length} symbols tracked`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`);
});