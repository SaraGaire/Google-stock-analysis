import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, BarChart, Bar } from 'recharts';
import { TrendingUp, Database, AlertTriangle, CheckCircle, BarChart3, Brain, Download, RefreshCw, Activity } from 'lucide-react';

const GoogleStockAnalysis = () => {
  const [data, setData] = useState([]);
  const [cleanedData, setCleanedData] = useState([]);
  const [enrichedData, setEnrichedData] = useState([]);
  const [stats, setStats] = useState({});
  const [modelMetrics, setModelMetrics] = useState({});
  const [predictions, setPredictions] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);

  const generateStockData = () => {
    const dataArray = [];
    const startDate = new Date('2020-01-01');
    const endDate = new Date('2025-11-11');
    let price = 68;
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        const momentum = Math.random() * 0.003 - 0.0005;
        const meanReversion = (100 - price) * 0.0001;
        const volatility = (Math.random() * 3 - 1.5);
        
        price = price * (1 + momentum + meanReversion) + volatility;
        price = Math.max(50, Math.min(200, price));
        
        const open = price + (Math.random() * 2 - 1);
        const high = Math.max(open, price) + Math.random() * 2;
        const low = Math.min(open, price) - Math.random() * 2;
        const volume = Math.floor(18000000 + Math.random() * 22000000);
        
        dataArray.push({
          date: d.toISOString().split('T')[0],
          open: parseFloat(open.toFixed(2)),
          high: parseFloat(high.toFixed(2)),
          low: parseFloat(low.toFixed(2)),
          close: parseFloat(price.toFixed(2)),
          volume: volume
        });
      }
    }
    
    const issuesData = [...dataArray];
    issuesData[100].close = null;
    issuesData[250].volume = null;
    issuesData.push(issuesData[500]);
    issuesData[300].close = issuesData[300].close * 2.8;
    issuesData[600].volume = issuesData[600].volume * 12;
    
    return issuesData;
  };

  const cleanData = (rawData) => {
    let cleaned = [...rawData];
    const issues = { nulls: 0, duplicates: 0, outliers: 0 };

    const uniqueDates = new Set();
    cleaned = cleaned.filter(row => {
      if (uniqueDates.has(row.date)) {
        issues.duplicates++;
        return false;
      }
      uniqueDates.add(row.date);
      return true;
    });

    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].close === null && i > 0) {
        cleaned[i].close = cleaned[i - 1].close;
        issues.nulls++;
      }
      if (cleaned[i].volume === null && i > 0) {
        cleaned[i].volume = cleaned[i - 1].volume;
        issues.nulls++;
      }
    }

    const closes = cleaned.map(d => d.close);
    const sortedCloses = [...closes].sort((a, b) => a - b);
    const median = sortedCloses[Math.floor(closes.length / 2)];
    const deviations = closes.map(v => Math.abs(v - median));
    const mad = [...deviations].sort((a, b) => a - b)[Math.floor(deviations.length / 2)];
    
    cleaned = cleaned.map((row, idx) => {
      const zScore = Math.abs((row.close - median) / (mad || 1));
      if (zScore > 3.5) {
        issues.outliers++;
        const windowStart = Math.max(0, idx - 2);
        const windowEnd = Math.min(cleaned.length, idx + 3);
        const window = cleaned.slice(windowStart, windowEnd);
        const windowValues = window.map(d => d.close).sort((a, b) => a - b);
        const smoothed = windowValues[Math.floor(windowValues.length / 2)];
        return { ...row, close: smoothed };
      }
      return row;
    });

    return { cleaned, issues };
  };

  const calculateTechnicalIndicators = (dataArray) => {
    return dataArray.map((row, i) => {
      const indicator = { ...row };
      
      if (i >= 9) {
        const sum = dataArray.slice(i - 9, i + 1).reduce((s, d) => s + d.close, 0);
        indicator.sma10 = sum / 10;
      }
      if (i >= 19) {
        const sum = dataArray.slice(i - 19, i + 1).reduce((s, d) => s + d.close, 0);
        indicator.sma20 = sum / 20;
      }
      if (i >= 49) {
        const sum = dataArray.slice(i - 49, i + 1).reduce((s, d) => s + d.close, 0);
        indicator.sma50 = sum / 50;
      }
      
      if (i >= 14) {
        const changes = dataArray.slice(i - 13, i + 1).map((d, idx, arr) => 
          idx > 0 ? d.close - arr[idx - 1].close : 0
        );
        const gains = changes.filter(c => c > 0);
        const losses = changes.filter(c => c < 0).map(c => -c);
        const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
        const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        indicator.rsi = 100 - (100 / (1 + rs));
      }
      
      if (i >= 19 && indicator.sma20) {
        const values = dataArray.slice(i - 19, i + 1).map(d => d.close);
        const variance = values.reduce((s, val) => s + Math.pow(val - indicator.sma20, 2), 0) / 20;
        const std = Math.sqrt(variance);
        indicator.upperBand = indicator.sma20 + (2 * std);
        indicator.lowerBand = indicator.sma20 - (2 * std);
        indicator.volatility = std;
      }
      
      return indicator;
    });
  };

  const trainLinearRegression = (X, y) => {
    const n = X.length;
    const sumX = X.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = X.reduce((s, x, i) => s + x * y[i], 0);
    const sumX2 = X.reduce((s, x) => s + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { 
      slope, 
      intercept, 
      predict: function(x) { return this.slope * x + this.intercept; }
    };
  };

  const trainPolynomialRegression = (X, y) => {
    const n = X.length;
    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumX3 = 0;
    let sumX4 = 0;
    let sumXY = 0;
    let sumX2Y = 0;
    
    for (let i = 0; i < n; i++) {
      const x = X[i];
      sumX += x;
      sumY += y[i];
      sumX2 += x * x;
      sumX3 += x * x * x;
      sumX4 += x * x * x * x;
      sumXY += x * y[i];
      sumX2Y += x * x * y[i];
    }
    
    const denom = (sumX2 * sumX2 - n * sumX4);
    const a = denom !== 0 ? (sumX2Y * sumX2 - sumXY * sumX3) / denom : 0;
    const b = sumX2 !== 0 ? (sumXY - a * sumX2) / sumX2 : 0;
    const c = (sumY - b * sumX - a * sumX2) / n;
    
    return { 
      a, 
      b, 
      c, 
      predict: function(x) { return this.a * x * x + this.b * x + this.c; }
    };
  };

  const evaluateModel = (actual, predicted) => {
    const n = actual.length;
    const mse = actual.reduce((s, val, i) => s + Math.pow(val - predicted[i], 2), 0) / n;
    const rmse = Math.sqrt(mse);
    const mean = actual.reduce((a, b) => a + b, 0) / n;
    const ssTotal = actual.reduce((s, val) => s + Math.pow(val - mean, 2), 0);
    const ssRes = actual.reduce((s, val, i) => s + Math.pow(val - predicted[i], 2), 0);
    const r2 = 1 - (ssRes / ssTotal);
    const mae = actual.reduce((s, val, i) => s + Math.abs(val - predicted[i]), 0) / n;
    
    return { 
      mse: mse.toFixed(2), 
      rmse: rmse.toFixed(2), 
      r2: r2.toFixed(4), 
      mae: mae.toFixed(2)
    };
  };

  useEffect(() => {
    const initializeData = () => {
      setIsLoading(true);
      
      const rawData = generateStockData();
      setData(rawData);
      
      const cleanResult = cleanData(rawData);
      const cleaned = cleanResult.cleaned;
      const issues = cleanResult.issues;
      setCleanedData(cleaned);
      
      const enriched = calculateTechnicalIndicators(cleaned);
      setEnrichedData(enriched);
      
      const closes = cleaned.map(d => d.close);
      const volumes = cleaned.map(d => d.volume);
      const returns = cleaned.slice(1).map((d, i) => (d.close - cleaned[i].close) / cleaned[i].close);
      
      setStats({
        totalRecords: rawData.length,
        cleanRecords: cleaned.length,
        issues,
        avgClose: (closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(2),
        maxClose: Math.max(...closes).toFixed(2),
        minClose: Math.min(...closes).toFixed(2),
        avgVolume: Math.floor(volumes.reduce((a, b) => a + b, 0) / volumes.length),
        avgReturn: (returns.reduce((a, b) => a + b, 0) / returns.length * 100).toFixed(2),
        volatility: (Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * 100).toFixed(2),
        sharpeRatio: ((returns.reduce((a, b) => a + b, 0) / returns.length) / Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length)).toFixed(2)
      });
      
      const splitIdx = Math.floor(cleaned.length * 0.8);
      const trainData = cleaned.slice(0, splitIdx);
      const testData = cleaned.slice(splitIdx);
      
      const X_train = trainData.map((item, i) => i);
      const y_train = trainData.map(d => d.close);
      const X_test = testData.map((item, i) => splitIdx + i);
      const y_test = testData.map(d => d.close);
      
      const linearModel = trainLinearRegression(X_train, y_train);
      const polyModel = trainPolynomialRegression(X_train, y_train);
      
      const trainPredLinear = X_train.map(x => linearModel.predict(x));
      const testPredLinear = X_test.map(x => linearModel.predict(x));
      const trainPredPoly = X_train.map(x => polyModel.predict(x));
      const testPredPoly = X_test.map(x => polyModel.predict(x));
      
      const ensembleTrain = trainPredLinear.map((p, i) => (p + trainPredPoly[i]) / 2);
      const ensembleTest = testPredLinear.map((p, i) => (p + testPredPoly[i]) / 2);
      
      setModelMetrics({
        linear: {
          train: evaluateModel(y_train, trainPredLinear),
          test: evaluateModel(y_test, testPredLinear)
        },
        polynomial: {
          train: evaluateModel(y_train, trainPredPoly),
          test: evaluateModel(y_test, testPredPoly)
        },
        ensemble: {
          train: evaluateModel(y_train, ensembleTrain),
          test: evaluateModel(y_test, ensembleTest)
        },
        splitIdx
      });
      
      const futurePredictions = [];
      for (let i = 1; i <= 30; i++) {
        const idx = cleaned.length + i - 1;
        const linear = linearModel.predict(idx);
        const poly = polyModel.predict(idx);
        futurePredictions.push({
          day: i,
          linear: linear,
          polynomial: poly,
          ensemble: (linear + poly) / 2
        });
      }
      setPredictions(futurePredictions);
      
      setIsLoading(false);
    };
    
    initializeData();
  }, []);

  const exportToCSV = () => {
    const headers = ['Date', 'Close', 'SMA10', 'SMA20', 'RSI', 'Volatility'];
    const rows = enrichedData.slice(-100).map(d => [
      d.date,
      d.close,
      d.sma10 || '',
      d.sma20 || '',
      d.rsi || '',
      d.volatility || ''
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'google_stock_analysis.csv';
    a.click();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-20 w-20 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <Brain className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-blue-600" size={32} />
          </div>
          <p className="text-lg text-gray-700 font-medium">Training Advanced ML Models...</p>
        </div>
      </div>
    );
  }

  const chartData = enrichedData.slice(-100).map(d => ({
    date: d.date.slice(5),
    close: d.close,
    sma10: d.sma10,
    sma20: d.sma20,
    sma50: d.sma50,
    volume: d.volume / 1000000,
    rsi: d.rsi,
    upperBand: d.upperBand,
    lowerBand: d.lowerBand
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg shadow-xl p-6 mb-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold flex items-center gap-3">
                <Brain size={36} />
                Advanced Stock Analysis Platform
              </h1>
              <p className="mt-2 text-blue-100">Google (GOOGL) • 2020-2025 • ML-Powered</p>
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

        <div className="bg-white rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="flex border-b">
            {['overview', 'technical', 'cleaning', 'models', 'predictions'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-6 py-4 font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <Database className="text-blue-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">{stats.totalRecords}</p>
                <p className="text-sm text-gray-600">Total Records</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <CheckCircle className="text-green-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">{stats.cleanRecords}</p>
                <p className="text-sm text-gray-600">Clean Records</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <TrendingUp className="text-purple-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">${stats.avgClose}</p>
                <p className="text-sm text-gray-600">Avg Price</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <BarChart3 className="text-orange-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">{(stats.avgVolume / 1000000).toFixed(1)}M</p>
                <p className="text-sm text-gray-600">Avg Volume</p>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <Activity className="text-red-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">{stats.volatility}%</p>
                <p className="text-sm text-gray-600">Volatility</p>
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <TrendingUp className="text-green-600 mb-2" size={24} />
                <p className="text-2xl font-bold text-gray-800">{stats.sharpeRatio}</p>
                <p className="text-sm text-gray-600">Sharpe Ratio</p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Price with Moving Averages (Last 100 Days)
              </h2>
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
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Trading Volume</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="volume" fill="#3b82f6" name="Volume (M)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {activeTab === 'technical' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Bollinger Bands</h2>
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
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">RSI (Relative Strength Index)</h2>
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
                <div className="text-center p-3 bg-red-50 rounded">
                  <p className="font-semibold text-red-600">Overbought</p>
                  <p className="text-gray-600">RSI &gt; 70</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded">
                  <p className="font-semibold text-gray-600">Neutral</p>
                  <p className="text-gray-600">30 ≤ RSI ≤ 70</p>
                </div>
                <div className="text-center p-3 bg-green-50 rounded">
                  <p className="font-semibold text-green-600">Oversold</p>
                  <p className="text-gray-600">RSI &lt; 30</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cleaning' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Data Quality Issues Detected & Resolved
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border-l-4 border-red-500 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="text-red-500" size={20} />
                    <h3 className="font-semibold text-gray-800">Missing Values</h3>
                  </div>
                  <p className="text-3xl font-bold text-red-600">{stats.issues?.nulls}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Handled using forward-fill imputation
                  </p>
                </div>
                
                <div className="border-l-4 border-yellow-500 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="text-yellow-500" size={20} />
                    <h3 className="font-semibold text-gray-800">Duplicate Records</h3>
                  </div>
                  <p className="text-3xl font-bold text-yellow-600">{stats.issues?.duplicates}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Removed based on date uniqueness
                  </p>
                </div>
                
                <div className="border-l-4 border-orange-500 pl-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="text-orange-500" size={20} />
                    <h3 className="font-semibold text-gray-800">Outliers</h3>
                  </div>
                  <p className="text-3xl font-bold text-orange-600">{stats.issues?.outliers}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Corrected using Modified Z-Score method
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Advanced Data Cleaning Pipeline
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">1. Duplicate Removal</h3>
                    <p className="text-sm text-gray-600">Identified and removed {stats.issues?.duplicates} duplicate entries based on date field</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                                    </div>

                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">2. Missing Value Imputation</h3>
                    <p className="text-sm text-gray-600">
                      Filled {stats.issues?.nulls} missing values using forward fill to preserve trend continuity.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">3. Outlier Correction</h3>
                    <p className="text-sm text-gray-600">
                      Replaced {stats.issues?.outliers} extreme close values with median-smoothed data using Modified Z-Score.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Model Performance</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {Object.entries(modelMetrics).map(([name, data]) => (
                  name !== "splitIdx" && (
                    <div key={name} className="border-l-4 border-blue-600 pl-4">
                      <h3 className="font-semibold text-gray-800 capitalize mb-2">{name} Model</h3>
                      <p className="text-sm text-gray-600">Train R²: {data.train.r2}</p>
                      <p className="text-sm text-gray-600">Test R²: {data.test.r2}</p>
                      <p className="text-sm text-gray-600">RMSE: {data.test.rmse}</p>
                    </div>
                  )
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Model Comparison (Test Set)</h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart
                  data={cleanedData.slice(modelMetrics.splitIdx).map((d, i) => ({
                    idx: i,
                    actual: d.close,
                    linear: modelMetrics.linear ? modelMetrics.linear.test : 0,
                    polynomial: modelMetrics.polynomial ? modelMetrics.polynomial.test : 0
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
            </div>
          </div>
        )}

        {activeTab === 'predictions' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Next 30-Day Forecast</h2>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleStockAnalysis;
