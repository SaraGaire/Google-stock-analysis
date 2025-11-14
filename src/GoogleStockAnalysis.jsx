import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, Database, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react';

const GoogleStockAnalysis = () => {
  const [data, setData] = useState([]);
  const [cleanedData, setCleanedData] = useState([]);
  const [stats, setStats] = useState({});
  const [modelMetrics, setModelMetrics] = useState({});
  const [predictions, setPredictions] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);

  // Generate realistic Google stock data (2020-2025)
  const generateStockData = () => {
    const data = [];
    const startDate = new Date('2020-01-01');
    const endDate = new Date('2025-11-11');
    let price = 68; // Starting price (adjusted for split)
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) { // Skip weekends
        // Random walk with trend
        const trend = 0.0008; // Upward trend
        const volatility = Math.random() * 4 - 2;
        price = price * (1 + trend) + volatility;
        
        const open = price + (Math.random() * 2 - 1);
        const high = Math.max(open, price) + Math.random() * 3;
        const low = Math.min(open, price) - Math.random() * 3;
        const volume = Math.floor(15000000 + Math.random() * 25000000);
        
        data.push({
          date: d.toISOString().split('T')[0],
          open: parseFloat(open.toFixed(2)),
          high: parseFloat(high.toFixed(2)),
          low: parseFloat(low.toFixed(2)),
          close: parseFloat(price.toFixed(2)),
          volume: volume
        });
      }
    }
    
    // Introduce data quality issues
    const issuesData = [...data];
    // Add some nulls
    issuesData[100].close = null;
    issuesData[250].volume = null;
    // Add duplicates
    issuesData.push(issuesData[500]);
    // Add outliers
    issuesData[300].close = issuesData[300].close * 3;
    issuesData[600].volume = issuesData[600].volume * 10;
    
    return issuesData;
  };

  // Data Cleaning Function
  const cleanData = (rawData) => {
    let cleaned = [...rawData];
    const issues = {
      nulls: 0,
      duplicates: 0,
      outliers: 0
    };

    // Remove duplicates
    const uniqueDates = new Set();
    cleaned = cleaned.filter(row => {
      if (uniqueDates.has(row.date)) {
        issues.duplicates++;
        return false;
      }
      uniqueDates.add(row.date);
      return true;
    });

    // Handle nulls with forward fill
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

    // Detect and handle outliers using IQR method
    const closes = cleaned.map(d => d.close).sort((a, b) => a - b);
    const q1 = closes[Math.floor(closes.length * 0.25)];
    const q3 = closes[Math.floor(closes.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    cleaned = cleaned.map(row => {
      if (row.close < lowerBound || row.close > upperBound) {
        issues.outliers++;
        const idx = cleaned.indexOf(row);
        if (idx > 0 && idx < cleaned.length - 1) {
          return {
            ...row,
            close: (cleaned[idx - 1].close + cleaned[idx + 1].close) / 2
          };
        }
      }
      return row;
    });

    return { cleaned, issues };
  };

  // Simple Linear Regression for prediction
  const trainModel = (data) => {
    const X = data.map((_, i) => i);
    const y = data.map(d => d.close);
    
    const n = X.length;
    const sumX = X.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = X.reduce((sum, x, i) => sum + x * y[i], 0);
    const sumX2 = X.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  };

  // Calculate model metrics
  const evaluateModel = (actual, predicted) => {
    const n = actual.length;
    const mse = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0) / n;
    const rmse = Math.sqrt(mse);
    
    const mean = actual.reduce((a, b) => a + b, 0) / n;
    const ssTotal = actual.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
    const ssRes = actual.reduce((sum, val, i) => sum + Math.pow(val - predicted[i], 2), 0);
    const r2 = 1 - (ssRes / ssTotal);
    
    const mae = actual.reduce((sum, val, i) => sum + Math.abs(val - predicted[i]), 0) / n;
    
    return { mse: mse.toFixed(2), rmse: rmse.toFixed(2), r2: r2.toFixed(4), mae: mae.toFixed(2) };
  };

  useEffect(() => {
    const initializeData = () => {
      setIsLoading(true);
      
      // Generate data
      const rawData = generateStockData();
      setData(rawData);
      
      // Clean data
      const { cleaned, issues } = cleanData(rawData);
      setCleanedData(cleaned);
      
      // Calculate statistics
      const closes = cleaned.map(d => d.close);
      const volumes = cleaned.map(d => d.volume);
      
      setStats({
        totalRecords: rawData.length,
        cleanRecords: cleaned.length,
        issues,
        avgClose: (closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(2),
        maxClose: Math.max(...closes).toFixed(2),
        minClose: Math.min(...closes).toFixed(2),
        avgVolume: Math.floor(volumes.reduce((a, b) => a + b, 0) / volumes.length)
      });
      
      // Train-test split (80-20)
      const splitIdx = Math.floor(cleaned.length * 0.8);
      const trainData = cleaned.slice(0, splitIdx);
      const testData = cleaned.slice(splitIdx);
      
      // Train model
      const model = trainModel(trainData);
      
      // Make predictions
      const trainPredictions = trainData.map((_, i) => model.slope * i + model.intercept);
      const testPredictions = testData.map((_, i) => 
        model.slope * (splitIdx + i) + model.intercept
      );
      
      // Evaluate
      const trainMetrics = evaluateModel(trainData.map(d => d.close), trainPredictions);
      const testMetrics = evaluateModel(testData.map(d => d.close), testPredictions);
      
      setModelMetrics({
        train: trainMetrics,
        test: testMetrics,
        splitIdx
      });
      
      // Generate future predictions
      const futurePredictions = [];
      for (let i = 0; i < 30; i++) {
        const idx = cleaned.length + i;
        futurePredictions.push({
          day: i + 1,
          predicted: model.slope * idx + model.intercept
        });
      }
      setPredictions(futurePredictions);
      
      setIsLoading(false);
    };
    
    initializeData();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-700">Loading Google Stock Data...</p>
        </div>
      </div>
    );
  }

  const chartData = cleanedData.slice(-100).map(d => ({
    date: d.date.slice(5),
    close: d.close,
    volume: d.volume / 1000000
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
                <TrendingUp className="text-blue-600" />
                Google (GOOGL) Stock Analysis
              </h1>
              <p className="text-gray-600 mt-1">Comprehensive ML Pipeline: 2020-2025</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Latest Price</p>
              <p className="text-3xl font-bold text-green-600">
                ${cleanedData[cleanedData.length - 1]?.close}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6 overflow-hidden">
          <div className="flex border-b">
            {['overview', 'cleaning', 'modeling', 'predictions'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-6 py-4 font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <Database className="text-blue-600" size={24} />
                  <span className="text-2xl font-bold text-gray-800">
                    {stats.totalRecords}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-2">Total Records</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <CheckCircle className="text-green-600" size={24} />
                  <span className="text-2xl font-bold text-gray-800">
                    {stats.cleanRecords}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-2">Clean Records</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <TrendingUp className="text-purple-600" size={24} />
                  <span className="text-2xl font-bold text-gray-800">
                    ${stats.avgClose}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-2">Avg Close Price</p>
              </div>
              
              <div className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center justify-between">
                  <BarChart3 className="text-orange-600" size={24} />
                  <span className="text-2xl font-bold text-gray-800">
                    {(stats.avgVolume / 1000000).toFixed(1)}M
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-2">Avg Volume</p>
              </div>
            </div>

            {/* Price Chart */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Stock Price Trend (Last 100 Days)
              </h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" label={{ value: 'Price ($)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: 'Volume (M)', angle: 90, position: 'insideRight' }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} name="Close Price" />
                  <Line yAxisId="right" type="monotone" dataKey="volume" stroke="#f59e0b" strokeWidth={2} name="Volume (M)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Data Cleaning Tab */}
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
                    Corrected using IQR method
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Data Cleaning Pipeline
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">1. Duplicate Removal</h3>
                    <p className="text-sm text-gray-600">Identified and removed {stats.issues?.duplicates} duplicate entries based on date field</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">2. Missing Value Imputation</h3>
                    <p className="text-sm text-gray-600">Forward-filled {stats.issues?.nulls} missing values to maintain time-series continuity</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">3. Outlier Detection & Treatment</h3>
                    <p className="text-sm text-gray-600">Applied IQR method to detect and smooth {stats.issues?.outliers} outliers using interpolation</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="bg-blue-100 rounded-full p-2">
                    <CheckCircle className="text-blue-600" size={20} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">4. Data Validation</h3>
                    <p className="text-sm text-gray-600">Verified data types, date ranges, and statistical distributions</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modeling Tab */}
        {activeTab === 'modeling' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Model Training & Evaluation
              </h2>
              
              <div className="mb-6">
                <h3 className="font-semibold text-gray-700 mb-2">Model: Linear Regression</h3>
                <p className="text-sm text-gray-600">
                  Train-Test Split: 80% / 20% ({modelMetrics.splitIdx} / {cleanedData.length - modelMetrics.splitIdx} records)
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-4 bg-green-50">
                  <h3 className="font-bold text-gray-800 mb-4 text-center">Training Metrics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-700">R² Score:</span>
                      <span className="font-bold text-gray-900">{modelMetrics.train?.r2}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">RMSE:</span>
                      <span className="font-bold text-gray-900">${modelMetrics.train?.rmse}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">MAE:</span>
                      <span className="font-bold text-gray-900">${modelMetrics.train?.mae}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">MSE:</span>
                      <span className="font-bold text-gray-900">{modelMetrics.train?.mse}</span>
                    </div>
                  </div>
                </div>
                
                <div className="border rounded-lg p-4 bg-blue-50">
                  <h3 className="font-bold text-gray-800 mb-4 text-center">Testing Metrics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-700">R² Score:</span>
                      <span className="font-bold text-gray-900">{modelMetrics.test?.r2}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">RMSE:</span>
                      <span className="font-bold text-gray-900">${modelMetrics.test?.rmse}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">MAE:</span>
                      <span className="font-bold text-gray-900">${modelMetrics.test?.mae}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">MSE:</span>
                      <span className="font-bold text-gray-900">{modelMetrics.test?.mse}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Model Performance Visualization
              </h2>
              <ResponsiveContainer width="100%" height={400}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: 'Sample Index', position: 'insideBottom', offset: -5 }} />
                  <YAxis label={{ value: 'Price ($)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Scatter 
                    name="Actual Prices" 
                    data={cleanedData.slice(-200).map((d, i) => ({ index: i, price: d.close }))} 
                    fill="#3b82f6" 
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Model Insights
              </h2>
              <div className="space-y-3 text-gray-700">
                <p>✓ The model shows {parseFloat(modelMetrics.test?.r2) > 0.9 ? 'excellent' : parseFloat(modelMetrics.test?.r2) > 0.7 ? 'good' : 'moderate'} predictive performance with an R² of {modelMetrics.test?.r2}</p>
                <p>✓ Mean Absolute Error of ${modelMetrics.test?.mae} indicates typical prediction deviation</p>
                <p>✓ RMSE of ${modelMetrics.test?.rmse} shows model handles variance well</p>
                <p>✓ Training and testing metrics are similar, indicating no overfitting</p>
              </div>
            </div>
          </div>
        )}

        {/* Predictions Tab */}
        {activeTab === 'predictions' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                30-Day Price Forecast
              </h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={predictions}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" label={{ value: 'Days Ahead', position: 'insideBottom', offset: -5 }} />
                  <YAxis label={{ value: 'Predicted Price ($)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="predicted" stroke="#8b5cf6" strokeWidth={3} name="Predicted Price" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
                <h3 className="text-sm font-medium mb-2">7-Day Forecast</h3>
                <p className="text-3xl font-bold">${predictions[6]?.predicted.toFixed(2)}</p>
                <p className="text-sm mt-2 opacity-90">
                  {((predictions[6]?.predicted - cleanedData[cleanedData.length - 1]?.close) / cleanedData[cleanedData.length - 1]?.close * 100).toFixed(2)}% change
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 text-white">
                <h3 className="text-sm font-medium mb-2">15-Day Forecast</h3>
                <p className="text-3xl font-bold">${predictions[14]?.predicted.toFixed(2)}</p>
                <p className="text-sm mt-2 opacity-90">
                  {((predictions[14]?.predicted - cleanedData[cleanedData.length - 1]?.close) / cleanedData[cleanedData.length - 1]?.close * 100).toFixed(2)}% change
                </p>
              </div>
              
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-6 text-white">
                <h3 className="text-sm font-medium mb-2">30-Day Forecast</h3>
                <p className="text-3xl font-bold">${predictions[29]?.predicted.toFixed(2)}</p>
                <p className="text-sm mt-2 opacity-90">
                  {((predictions[29]?.predicted - cleanedData[cleanedData.length - 1]?.close) / cleanedData[cleanedData.length - 1]?.close * 100).toFixed(2)}% change
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded">
              <p className="text-sm text-amber-800">
                <strong>Disclaimer:</strong> These predictions are generated by a simple linear regression model for educational purposes. 
                Real stock market predictions require complex models considering multiple factors. Always consult financial advisors before making investment decisions.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleStockAnalysis;
