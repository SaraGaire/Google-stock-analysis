// src/lib/dataSources.js
export async function fetchAlphaVantageDaily(symbol) {
  const key = import.meta.env.VITE_ALPHA_VANTAGE_KEY;
  if (!key) throw new Error("NO_ALPHA_KEY");
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
    symbol
  )}&outputsize=full&datatype=json&apikey=${key}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  const j = await r.json();

  // Alpha Vantage returns errors in JSON fields
  if (j["Error Message"] || j["Note"]) {
    throw new Error(j["Error Message"] || j["Note"] || "ALPHA_ERROR");
  }

  const ts = j["Time Series (Daily)"];
  if (!ts) throw new Error("ALPHA_SHAPE");

  // Most recent first, so convert to array & sort by date asc
  const rows = Object.entries(ts)
    .map(([date, o]) => ({
      date,
      open: +o["1. open"],
      high: +o["2. high"],
      low: +o["3. low"],
      close: +o["5. adjusted close"], // adjusted
      volume: +o["6. volume"],
    }))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return rows;
}

// Stooq CSV: e.g., GOOG on US market is goog.us (or googl.us for Alphabet A)
// We'll default to goog.us (GOOG) if user passes GOOGL
const stooqTicker = (symbol) =>
  symbol.toLowerCase() === "googl" ? "googl.us" : symbol.toLowerCase() + ".us";

// Example CSV URL: https://stooq.com/q/d/l/?s=goog.us&i=d
export async function fetchStooqDaily(symbol) {
  const sym = stooqTicker(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP_${r.status}`);
  const text = await r.text();

  // CSV header: Date,Open,High,Low,Close,Volume
  const lines = text.trim().split("\n");
  const header = lines.shift();
  if (!/date,open,high,low,close,volume/i.test(header))
    throw new Error("STOOQ_SHAPE");

  const rows = lines
    .map((ln) => {
      const [date, open, high, low, close, volume] = ln.split(",");
      return {
        date,
        open: +open,
        high: +high,
        low: +low,
        close: +close,
        volume: +volume,
      };
    })
    .filter((d) => !Number.isNaN(d.close))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return rows;
}

export async function fetchRealData(symbol = "GOOGL") {
  try {
    return await fetchAlphaVantageDaily(symbol);
  } catch (e) {
    // Fallback: Stooq CSV (no key)
    return await fetchStooqDaily(symbol);
  }
}
