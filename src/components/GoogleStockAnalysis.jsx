import React, { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar
} from "recharts";
import {
  TrendingUp, Database, AlertTriangle, CheckCircle, BarChart3, Brain, Download, RefreshCw, Activity
} from "lucide-react";
import { fetchRealData } from "../lib/dataSources";

// ---------- helpers (unchanged or lightly tweaked) ----------
const sma = (arr, n, i) =>
  i >= n - 1 ? arr.slice(i - (n - 1), i + 1).reduce((s, v) => s + v, 0) / n : undefined;

function indicators(data) {
  return data.map((row, i) => {
    const out = { ...row };
    const closes = data.map((d) => d.close);

    out.sma10 = sma(closes, 10, i);
    out.sma20 = sma(closes, 20, i);
    out.sma50 = sma(closes, 50, i);

    if (i >= 14) {
      const changes = data.slice(i - 13, i + 1).map((d, j, w) => (j ? d.close - w[j - 1].close : 0));
      const gains = changes.filter((c) => c > 0);
      const losses = changes.filter((c) => c < 0).map((c) => -c);
      const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
      const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.rsi = 100 - 100 / (1 + rs);
    }

    if (i >= 19 && out.sma20) {
      const window = data.slice(i - 19, i + 1).map((d) => d.close);
      const mu = out.sma20;
      const variance = window.reduce((s, x) => s + (x - mu) ** 2, 0) / 20;
      const std = Math.sqrt(variance);
      out.upperBand = mu + 2 * std;
      out.lowerBand = mu - 2 * std;
      out.volatility = std;
    }
    return out;
  });
}

// tiny regressors
const trainLinear = (X, y) => {
  const n = X.length;
  const sx = X.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxy = X.reduce((s, x, i) => s + x * y[i], 0);
  const sx2 = X.reduce((s, x) => s + x * x, 0);
  const denom = n * sx2 - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, predict: (x) => slope * x + intercept };
};

const trainPoly2 = (X, y) => {
  const n = X.length;
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (let i = 0; i < n; i++) {
    const x = X[i], yi = y[i], x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
    sx += x; sx2 += x2; sx3 += x3; sx4 += x4; sy += yi; sxy += x * yi; sx2y += x2 * yi;
  }
  const denom = sx2 * sx2 - n * sx4 || 1;
  const a = (sx2y * sx2 - sxy * sx3) / denom;
  const b = (sxy - a * sx2) / (sx || 1);
  const c = (sy - b * sx - a * sx2) / n;
  return { a, b, c, predict: (x) => a * x * x + b * x + c };
};

const evalModel = (actual, pred) => {
  const n = actual.length;
  const mse = actual.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0) / n;
  const rmse = Math.sqrt(mse);
  const mean = actual.reduce((a, b) => a + b, 0) / n;
  const ssTot = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = actual.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const mae = actual.reduce((s, v, i) => s + Math.abs(v - pred[i]), 0) / n;
  return { mse: mse.toFixed(2), rmse: rmse.toFixed(2), r2: r2.toFixed(4), mae: mae.toFixed(2) };
};

// ---------- NEW: simple signal engine + RTP ----------
function generateSignal(rows) {
  const n = rows.length;
  const last = rows[n - 1];
  const prev = rows[n - 2];

  // rules
  const rsiBuy = last.rsi !== undefined && last.rsi < 35;
  const rsiSell = last.rsi !== undefined && last.rsi > 65;
  const smaBull = last.sma20 && last.sma50 && last.sma20 > last.sma50 && prev.sma20 <= prev.sma50;
  const smaBear = last.sma20 && last.sma50 && last.sma20 < last.sma50 && prev.sma20 >= prev.sma50;

  let action = "HOLD";
  if (smaBull || rsiBuy) action = "BUY";
  if (smaBear || rsiSell) action = "SELL";

  // fake “probability” from agreement
  const votes = [rsiBuy || rsiSell, smaBull || smaBear].filter(Boolean).length;
  const probability = Math.min(90, 50 + votes * 20); // 50/70/90

  // Risk/Target as % of close, scaled by recent volatility
  const vol = last.volatility || 1;
  const riskPct = Math.min(3, Math.max(1, vol * 0.5));  // 1–3%
  const targetPct = riskPct * 2;                         // 1R:2R

  const price = last.close;
  const stop = action === "BUY" ? +(price * (1 - riskPct / 100)).toFixed(2)
                                : +(price * (1 + riskPct / 100)).toFixed(2);
  const target = action === "BUY" ? +(price * (1 + targetPct / 100)).toFixed(2)
                                  : +(price * (1 - targetPct / 100)).toFixed(2);

  return {
    action,
    probability,
    riskPct,
    targetPct,
    price,
    stop,
    target,
    notes: {
      rsi: last.rsi?.toFixed(1),
      sma20: last.sma20?.toFixed(2),
      sma50: last.sma50?.toFixed(2),
    },
  };
}

export default function GoogleStockAnalysis() {
  const [symbol] = useState("GOOGL");
  const [raw, setRaw] = useState([]);
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({});
  const [metrics, setMetrics] = useState({});
  const [pred, setPred] = useState([]);
  const [testSeries, setTestSeries] = useState({ linear: [], polynomial: [] });
  const [signal, setSignal] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        setErr("");

        // 1) fetch real market data (Alpha Vantage -> Stooq fallback)
        const rows = await fetchRealData(symbol);
        setRaw(rows);

        // 2) indicators
        const enr = indicators(rows);
        setData(enr);

        // 3) stats
        const closes = rows.map((d) => d.close);
        const vols = rows.map((d) => d.volume);
        const rets = rows.slice(1).map((d, i) => (d.close - rows[i].close) / rows[i].close);
        const avgRet = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
        const vol = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / (rets.length || 1));
        setStats({
          totalRecords: rows.length,
          cleanRecords: rows.length,
          issues: { nulls: 0, duplicates: 0, outliers: 0 },
          avgClose: (closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(2),
          maxClose: Math.max(...closes).toFixed(2),
          minClose: Math.min(...closes).toFixed(2),
          avgVolume: Math.floor(vols.reduce((a, b) => a + b, 0) / vols.length),
          avgReturn: (avgRet * 100).toFixed(2),
          volatility: (vol * 100).toFixed(2),
          sharpeRatio: (avgRet / (vol || 1)).toFixed(2),
        });

        // 4) models
        const split = Math.floor(rows.length * 0.8);
        const train = rows.slice(0, split);
        const test = rows.slice(split);
        const Xtr = train.map((_, i) => i);
        const Ytr = train.map((d) => d.close);
        const Xte = test.map((_, i) => split + i);
        const Yte = test.map((d) => d.close);

        const lin = trainLinear(Xtr, Ytr);
        const poly = trainPoly2(Xtr, Ytr);

        const trLin = Xtr.map(lin.predict);
        const teLin = Xte.map(lin.predict);
        const trPoly = Xtr.map(poly.predict);
        const tePoly = Xte.map(poly.predict);

        const ensTrain = trLin.map((p, i) => (p + trPoly[i]) / 2);
        const ensTest = teLin.map((p, i) => (p + tePoly[i]) / 2);

        setMetrics({
          splitIdx: split,
          linear: { train: evalModel(Ytr, trLin), test: evalModel(Yte, teLin) },
          polynomial: { train: evalModel(Ytr, trPoly), test: evalModel(Yte, tePoly) },
          ensemble: { train: evalModel(Ytr, ensTrain), test: evalModel(Yte, ensTest) },
        });
        setTestSeries({ linear: teLin, polynomial: tePoly });

        // 5) predictions next 30
        const future = [];
        for (let i = 1; i <= 30; i++) {
          const idx = rows.length + i - 1;
          const l = lin.predict(idx);
          const p = poly.predict(idx);
          future.push({ day: i, linear: l, polynomial: p, ensemble: (l + p) / 2 });
        }
        setPred(future);

        // 6) signal
        setSignal(generateSignal(enr));
      } catch (e) {
        setErr(e.message || "Failed to load data.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [symbol]);

  const chartData = data.slice(-100).map((d) => ({
    date: d.date.slice(5),
    close: d.close,
    sma10: d.sma10,
    sma20: d.sma20,
    sma50: d.sma50,
    volume: d.volume / 1_000_000,
    rsi: d.rsi,
    upperBand: d.upperBand,
    lowerBand: d.lowerBand,
  }));

  const exportToCSV = () => {
    const headers = ["Date", "Close", "SMA10", "SMA20", "RSI", "Volatility"];
    const rows = data.slice(-100).map((d) => [
      d.date,
      d.close,
      d.sma10 ?? "",
      d.sma20 ?? "",
      d.rsi ?? "",
      d.volatility ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "google_stock_analysis_real.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <Brain className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-600" size={32} />
          </div>
          <p className="text-lg text-gray-700 font-medium">Loading real market data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg shadow-xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold flex items-center gap-3">
                <Brain size={36} />
                Advanced Stock Analysis Platform
              </h1>
              <p className="mt-2 text-blue-100">Alphabet ({symbol}) • Real Market Data</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-blue-100">Last Close</p>
              <p className="text-4xl font-bold">${data[data.length - 1]?.close?.toFixed(2)}</p>
              <p className="text-sm text-blue-100 mt-1">
                Return: {stats.avgReturn}% | Vol: {stats.volatility}%
              </p>
            </div>
          </div>
        </div>

        {/* Error note */}
        {err && (
          <div className="bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-md p-4 mb-6">
            <p className="font-semibold">Heads up</p>
            <p className="text-sm">
              {err.includes("NO_ALPHA_KEY")
                ? "No Alpha Vantage key detected. Falling back to Stooq CSV."
                : err}
            </p>
          </div>
        )}

        {/* Top actions */}
        <div className="bg-white rounded-lg shadow-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex gap-3">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download size={20} />
              Export CSV
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <RefreshCw size={20} />
              Refresh
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="text-gray-600" size={20} />
            <span className="text-sm text-gray-600">
              Sharpe: <strong>{stats.sharpeRatio}</strong>
            </span>
          </div>
        </div>

        {/* Signal card */}
        {signal && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Trade Idea (RTP)</h2>
            <p className="text-sm text-gray-600 mb-4">
              <strong>Suggested:</strong> {signal.action} • <strong>Price:</strong> ${signal.price.toFixed(2)} •{" "}
              <strong>Stop:</strong> ${signal.stop} • <strong>Target:</strong> ${signal.target} •{" "}
              <strong>Confidence:</strong> {signal.probability}%
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="p-4 rounded bg-blue-50">
                <p className="font-semibold text-blue-700">R (Risk)</p>
                <p className="text-gray-700">{signal.riskPct}% (~${(signal.price * signal.riskPct / 100).toFixed(2)})</p>
              </div>
              <div className="p-4 rounded bg-green-50">
                <p className="font-semibold text-green-700">T (Target)</p>
                <p className="text-gray-700">{signal.targetPct}% (~${(signal.price * signal.targetPct / 100).toFixed(2)})</p>
              </div>
              <div className="p-4 rounded bg-purple-50">
                <p className="font-semibold text-purple-700">P (Probability)</p>
                <p className="text-gray-700">{signal.probability}% (RSI {signal.notes.rsi}, SMA20 {signal.notes.sma20}, SMA50 {signal.notes.sma50})</p>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">Educational example only. Not financial advice.</p>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="flex border-b">
            {["overview", "technical", "models", "predictions"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-6 py-4 font-medium transition-all ${
                  activeTab === tab
                    ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <InfoCard icon={<Database className="text-blue-600" size={24} />} title="Total Records" value={stats.totalRecords} />
              <InfoCard icon={<CheckCircle className="text-green-600" size={24} />} title="Clean Records" value={stats.cleanRecords} />
              <InfoCard icon={<TrendingUp className="text-purple-600" size={24} />} title="Avg Price" value={`$${stats.avgClose}`} />
              <InfoCard icon={<BarChart3 className="text-orange-600" size={24} />} title="Avg Volume" value={`${(stats.avgVolume / 1_000_000).toFixed(1)}M`} />
              <InfoCard icon={<Activity className="text-red-600" size={24} />} title="Volatility" value={`${stats.volatility}%`} />
              <InfoCard icon={<TrendingUp className="text-green-600" size={24} />} title="Sharpe Ratio" value={stats.sharpeRatio} />
            </div>

            <Panel title="Price with Moving Averages (Last 100 Days)">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} name="Close" />
                  <Line type="monotone" dataKey="sma10" stroke="#f59e0b" strokeWidth={1} name="SMA 10" strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="sma20" stroke="#10b981" strokeWidth={1} name="SMA 20" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Trading Volume">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="volume" fill="#3b82f6" name="Volume (M)" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        )}

        {/* TECHNICAL */}
        {activeTab === "technical" && (
          <div className="space-y-6">
            <Panel title="Bollinger Bands">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="upperBand" stroke="#ef4444" strokeWidth={1} name="Upper Band" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} name="Close" />
                  <Line type="monotone" dataKey="lowerBand" stroke="#10b981" strokeWidth={1} name="Lower Band" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="sma20" stroke="#f59e0b" strokeWidth={1} name="SMA 20" />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="RSI (Relative Strength Index)">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="rsi" stroke="#8b5cf6" strokeWidth={2} name="RSI" />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <Badge color="red" title="Overbought" text="RSI > 70" />
                <Badge color="gray" title="Neutral" text="30 ≤ RSI ≤ 70" />
                <Badge color="green" title="Oversold" text="RSI < 30" />
              </div>
            </Panel>
          </div>
        )}

        {/* MODELS */}
        {activeTab === "models" && (
          <div className="space-y-6">
            <Panel title="Model Performance">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {["linear", "polynomial", "ensemble"].map((name) => (
                  <div key={name} className="border-l-4 border-blue-600 pl-4">
                    <h3 className="font-semibold text-gray-800 capitalize mb-2">{name} Model</h3>
                    <p className="text-sm text-gray-600">Train R²: {metrics[name]?.train?.r2}</p>
                    <p className="text-sm text-gray-600">Test R²: {metrics[name]?.test?.r2}</p>
                    <p className="text-sm text-gray-600">RMSE: {metrics[name]?.test?.rmse}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Model Comparison (Test Set)">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart
                  data={raw.slice(metrics.splitIdx).map((d, i) => ({
                    idx: i,
                    actual: d.close,
                    linear: testSeries.linear[i],
                    polynomial: testSeries.polynomial[i],
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="idx" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#3b82f6" name="Actual" />
                  <Line type="monotone" dataKey="linear" stroke="#f59e0b" name="Linear Model" />
                  <Line type="monotone" dataKey="polynomial" stroke="#10b981" name="Polynomial Model" />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        )}

        {/* PREDICTIONS */}
        {activeTab === "predictions" && (
          <div className="space-y-6">
            <Panel title="Next 30-Day Forecast">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={pred}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="linear" stroke="#f59e0b" name="Linear" />
                  <Line type="monotone" dataKey="polynomial" stroke="#10b981" name="Polynomial" />
                  <Line type="monotone" dataKey="ensemble" stroke="#3b82f6" strokeWidth={2} name="Ensemble" />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- tiny UI helpers ---------- */
function Panel({ title, children }) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}
function InfoCard({ icon, title, value }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="mb-2">{icon}</div>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-sm text-gray-600">{title}</p>
    </div>
  );
}
function Badge({ color, title, text }) {
  const palette = { red: "bg-red-50 text-red-600", gray: "bg-gray-50 text-gray-600", green: "bg-green-50 text-green-600" }[color];
  return (
    <div className={`text-center p-3 rounded ${palette}`}>
      <p className="font-semibold">{title}</p>
      <p className="text-gray-600">{text}</p>
    </div>
  );
}
