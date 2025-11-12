import React, { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from "recharts";
import {
  TrendingUp, Database, AlertTriangle, CheckCircle, BarChart3, Brain, Download, RefreshCw, Activity
} from "lucide-react";

/**
 * This component:
 * - Generates synthetic daily OHLCV data for GOOGL (weekdays 2020-01-01..2025-11-11)
 * - Injects typical data issues (nulls, dups, outliers)
 * - Cleans data (dedupe, ffill nulls, robust outlier fix)
 * - Computes SMA10/20/50, RSI(14), Bollinger Bands (20, 2σ)
 * - Trains very simple Linear & Quadratic (2nd-order) regressors on index vs close
 * - Evaluates metrics, visualizes price/indicators, model comparison, and 30-day forecast
 */

export default function GoogleStockAnalysis() {
  const [data, setData] = useState([]);
  const [cleanedData, setCleanedData] = useState([]);
  const [enrichedData, setEnrichedData] = useState([]);
  const [stats, setStats] = useState({});
  const [modelMetrics, setModelMetrics] = useState({});
  const [predictions, setPredictions] = useState([]);
  const [testPredSeries, setTestPredSeries] = useState({ linear: [], polynomial: [] });
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoading, setIsLoading] = useState(true);

  // ---------- 1) Simulate raw stock data + inject issues ----------
  const generateStockData = () => {
    const dataArray = [];
    const startDate = new Date("2020-01-01");
    const endDate = new Date("2025-11-11");
    let price = 68;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      // weekdays only
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        const momentum = Math.random() * 0.003 - 0.0005;
        const meanReversion = (100 - price) * 0.0001;
        const volatility = Math.random() * 3 - 1.5;

        price = price * (1 + momentum + meanReversion) + volatility;
        price = Math.max(50, Math.min(200, price));

        const open = price + (Math.random() * 2 - 1);
        const high = Math.max(open, price) + Math.random() * 2;
        const low = Math.min(open, price) - Math.random() * 2;
        const volume = Math.floor(18_000_000 + Math.random() * 22_000_000);

        dataArray.push({
          date: d.toISOString().split("T")[0],
          open: +open.toFixed(2),
          high: +high.toFixed(2),
          low: +low.toFixed(2),
          close: +price.toFixed(2),
          volume,
        });
      }
    }

    // clone to inject issues
    const issuesData = [...dataArray];

    // 1) missing values
    if (issuesData[100]) issuesData[100].close = null;
    if (issuesData[250]) issuesData[250].volume = null;

    // 2) duplicate row
    if (issuesData[500]) issuesData.push(issuesData[500]);

    // 3) outliers
    if (issuesData[300]) issuesData[300].close = issuesData[300].close * 2.8;
    if (issuesData[600]) issuesData[600].volume = issuesData[600].volume * 12;

    return issuesData;
  };

  // ---------- 2) Clean data ----------
  const cleanData = (rawData) => {
    let cleaned = [...rawData];
    const issues = { nulls: 0, duplicates: 0, outliers: 0 };

    // remove duplicates by date
    const seen = new Set();
    cleaned = cleaned.filter((row) => {
      if (seen.has(row.date)) {
        issues.duplicates++;
        return false;
      }
      seen.add(row.date);
      return true;
    });

    // forward-fill close/volume nulls
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].close == null && i > 0) {
        cleaned[i].close = cleaned[i - 1].close;
        issues.nulls++;
      }
      if (cleaned[i].volume == null && i > 0) {
        cleaned[i].volume = cleaned[i - 1].volume;
        issues.nulls++;
      }
    }

    // robust outlier fix on close using MAD
    const closes = cleaned.map((d) => d.close);
    const sorted = [...closes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const deviations = closes.map((v) => Math.abs(v - median));
    const mad = [...deviations].sort((a, b) => a - b)[Math.floor(deviations.length / 2)] || 1;

    cleaned = cleaned.map((row, idx) => {
      const z = Math.abs((row.close - median) / mad);
      if (z > 3.5) {
        issues.outliers++;
        const win = cleaned.slice(Math.max(0, idx - 2), Math.min(cleaned.length, idx + 3));
        const winMedian = [...win.map((d) => d.close)].sort((a, b) => a - b)[Math.floor(win.length / 2)];
        return { ...row, close: winMedian };
      }
      return row;
    });

    return { cleaned, issues };
  };

  // ---------- 3) Indicators ----------
  const calculateTechnicalIndicators = (arr) =>
    arr.map((row, i) => {
      const out = { ...row };

      // SMA
      if (i >= 9) out.sma10 = arr.slice(i - 9, i + 1).reduce((s, d) => s + d.close, 0) / 10;
      if (i >= 19) out.sma20 = arr.slice(i - 19, i + 1).reduce((s, d) => s + d.close, 0) / 20;
      if (i >= 49) out.sma50 = arr.slice(i - 49, i + 1).reduce((s, d) => s + d.close, 0) / 50;

      // RSI(14)
      if (i >= 14) {
        const changes = arr.slice(i - 13, i + 1).map((d, j, win) => (j ? d.close - win[j - 1].close : 0));
        const gains = changes.filter((c) => c > 0);
        const losses = changes.filter((c) => c < 0).map((c) => -c);
        const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
        const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out.rsi = 100 - 100 / (1 + rs);
      }

      // Bollinger (20, 2σ)
      if (i >= 19 && out.sma20) {
        const vals = arr.slice(i - 19, i + 1).map((d) => d.close);
        const mu = out.sma20;
        const variance = vals.reduce((s, v) => s + (v - mu) ** 2, 0) / 20;
        const std = Math.sqrt(variance);
        out.upperBand = mu + 2 * std;
        out.lowerBand = mu - 2 * std;
        out.volatility = std;
      }

      return out;
    });

  // ---------- 4) Tiny regression helpers ----------
  const trainLinearRegression = (X, y) => {
    const n = X.length;
    const sumX = X.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = X.reduce((s, x, i) => s + x * y[i], 0);
    const sumX2 = X.reduce((s, x) => s + x * x, 0);

    const denom = n * sumX2 - sumX * sumX || 1;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept, predict: (x) => slope * x + intercept };
  };

  // Quadratic: y = a x^2 + b x + c (normal eqns for sums)
  const trainPolynomialRegression = (X, y) => {
    const n = X.length;
    let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
    for (let i = 0; i < n; i++) {
      const x = X[i], yi = y[i];
      const x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
      sx += x; sx2 += x2; sx3 += x3; sx4 += x4;
      sy += yi; sxy += x * yi; sx2y += x2 * yi;
    }
    // Solve a,b,c from normal equations (2x2 reduced approach)
    const denom = sx2 * sx2 - n * sx4 || 1;
    const a = (sx2y * sx2 - sxy * sx3) / denom;
    const b = (sxy - a * sx2) / (sx || 1);
    const c = (sy - b * sx - a * sx2) / n;
    return { a, b, c, predict: (x) => a * x * x + b * x + c };
  };

  const evaluateModel = (actual, predicted) => {
    const n = actual.length;
    const mse = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0) / n;
    const rmse = Math.sqrt(mse);
    const mean = actual.reduce((a, b) => a + b, 0) / n;
    const ssTot = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
    const ssRes = actual.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
    const r2 = 1 - ssRes / ssTot;
    const mae = actual.reduce((s, v, i) => s + Math.abs(v - predicted[i]), 0) / n;
    return { mse: mse.toFixed(2), rmse: rmse.toFixed(2), r2: r2.toFixed(4), mae: mae.toFixed(2) };
  };

  // ---------- 5) Initialize pipeline ----------
  useEffect(() => {
    setIsLoading(true);

    // raw
    const raw = generateStockData();
    setData(raw);

    // clean
    const { cleaned, issues } = cleanData(raw);
    setCleanedData(cleaned);

    // enrich
    const enriched = calculateTechnicalIndicators(cleaned);
    setEnrichedData(enriched);

    // summary stats
    const closes = cleaned.map((d) => d.close);
    const volumes = cleaned.map((d) => d.volume);
    const rets = cleaned.slice(1).map((d, i) => (d.close - cleaned[i].close) / cleaned[i].close);
    const avgRet = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const vol = Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / (rets.length || 1));
    setStats({
      totalRecords: raw.length,
      cleanRecords: cleaned.length,
      issues,
      avgClose: (closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(2),
      maxClose: Math.max(...closes).toFixed(2),
      minClose: Math.min(...closes).toFixed(2),
      avgVolume: Math.floor(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      avgReturn: (avgRet * 100).toFixed(2),
      volatility: (vol * 100).toFixed(2),
      sharpeRatio: (avgRet / (vol || 1)).toFixed(2),
    });

    // split
    const splitIdx = Math.floor(cleaned.length * 0.8);
    const train = cleaned.slice(0, splitIdx);
    const test = cleaned.slice(splitIdx);

    const Xtr = train.map((_, i) => i);
    const Ytr = train.map((d) => d.close);
    const Xte = test.map((_, i) => splitIdx + i);
    const Yte = test.map((d) => d.close);

    // train
    const lin = trainLinearRegression(Xtr, Ytr);
    const poly = trainPolynomialRegression(Xtr, Ytr);

    // preds
    const trLin = Xtr.map(lin.predict);
    const teLin = Xte.map(lin.predict);
    const trPoly = Xtr.map(poly.predict);
    const tePoly = Xte.map(poly.predict);

    const ensTrain = trLin.map((p, i) => (p + trPoly[i]) / 2);
    const ensTest = teLin.map((p, i) => (p + tePoly[i]) / 2);

    setModelMetrics({
      splitIdx,
      linear: { train: evaluateModel(Ytr, trLin), test: evaluateModel(Yte, teLin) },
      polynomial: { train: evaluateModel(Ytr, trPoly), test: evaluateModel(Yte, tePoly) },
      ensemble: { train: evaluateModel(Ytr, ensTrain), test: evaluateModel(Yte, ensTest) },
    });

    setTestPredSeries({ linear: teLin, polynomial: tePoly });

    // 30-day simple forecast (by index)
    const future = [];
    for (let i = 1; i <= 30; i++) {
      const idx = cleaned.length + i - 1;
      const l = lin.predict(idx);
      const p = poly.predict(idx);
      future.push({ day: i, linear: l, polynomial: p, ensemble: (l + p) / 2 });
    }
    setPredictions(future);

    setIsLoading(false);
  }, []);

  // ---------- 6) Helpers for charts ----------
  const chartData = enrichedData.slice(-100).map((d) => ({
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
    const rows = enrichedData.slice(-100).map((d) => [
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
    a.download = "google_stock_analysis.csv";
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
          <p className="text-lg text-gray-700 font-medium">Training Advanced ML Models...</p>
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
              <p className="mt-2 text-blue-100">Google (GOOGL) • 2020–2025 • ML-Powered</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-blue-100">Current Price</p>
              <p className="text-4xl font-bold">${cleanedData[cleanedData.length - 1]?.close}</p>
              <p className="text-sm text-blue-100 mt-1">
                Return: {stats.avgReturn}% | Vol: {stats.volatility}%
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
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

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="flex border-b">
            {["overview", "technical", "cleaning", "models", "predictions"].map((tab) => (
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

        {/* CLEANING */}
        {activeTab === "cleaning" && (
          <div className="space-y-6">
            <Panel title="Data Quality Issues Detected & Resolved">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <IssueCard color="red" title="Missing Values" count={stats.issues?.nulls} note="Handled using forward-fill imputation" />
                <IssueCard color="yellow" title="Duplicate Records" count={stats.issues?.duplicates} note="Removed based on date uniqueness" />
                <IssueCard color="orange" title="Outliers" count={stats.issues?.outliers} note="Corrected using Modified Z-Score method" />
              </div>
            </Panel>

            <Panel title="Advanced Data Cleaning Pipeline">
              <Step title="1. Duplicate Removal" text={`Identified and removed ${stats.issues?.duplicates} duplicate entries based on date field.`} />
              <Step title="2. Missing Value Imputation" text={`Filled ${stats.issues?.nulls} missing values using forward fill to preserve trend continuity.`} />
              <Step title="3. Outlier Correction" text={`Replaced ${stats.issues?.outliers} extreme close values with median-smoothed data (MAD).`} />
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
                    <p className="text-sm text-gray-600">Train R²: {modelMetrics[name]?.train?.r2}</p>
                    <p className="text-sm text-gray-600">Test R²: {modelMetrics[name]?.test?.r2}</p>
                    <p className="text-sm text-gray-600">RMSE: {modelMetrics[name]?.test?.rmse}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Model Comparison (Test Set)">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart
                  data={cleanedData.slice(modelMetrics.splitIdx).map((d, i) => ({
                    idx: i,
                    actual: d.close,
                    linear: testPredSeries.linear[i],
                    polynomial: testPredSeries.polynomial[i],
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
                <LineChart data={predictions}>
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

/* ---------- Small presentational helpers ---------- */
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
  const palette = {
    red: "bg-red-50 text-red-600",
    gray: "bg-gray-50 text-gray-600",
    green: "bg-green-50 text-green-600",
  }[color];
  return (
    <div className={`text-center p-3 rounded ${palette}`}>
      <p className="font-semibold">{title}</p>
      <p className="text-gray-600">{text}</p>
    </div>
  );
}

function IssueCard({ color, title, count, note }) {
  const border = {
    red: "border-red-500",
    yellow: "border-yellow-500",
    orange: "border-orange-500",
  }[color];
  const text = {
    red: "text-red-600",
    yellow: "text-yellow-600",
    orange: "text-orange-600",
  }[color];

  return (
    <div className={`border-l-4 ${border} pl-4`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className={`${text}`} size={20} />
        <h3 className="font-semibold text-gray-800">{title}</h3>
      </div>
      <p className={`text-3xl font-bold ${text}`}>{count}</p>
      <p className="text-sm text-gray-600 mt-2">{note}</p>
    </div>
  );
}

function Step({ title, text }) {
  return (
    <div className="flex items-start gap-4 mb-3">
      <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
        <CheckCircle className="text-blue-600" size={20} />
      </div>
      <div>
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <p className="text-sm text-gray-600">{text}</p>
      </div>
    </div>
  );
}
