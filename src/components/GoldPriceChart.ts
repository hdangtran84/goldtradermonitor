/**
 * GoldPriceChart - Real-time Gold (XAUUSD / XAUT/USDT) price chart component
 * Uses D3 for SVG-based line chart rendering with dark theme support.
 * Includes predictive trend line using linear regression with news sentiment adjustment.
 * 
 * Data sources:
 * - Primary: XAUT/USDT (Tether Gold) from CoinGecko for 24/7 crypto gold data
 * - Fallback: GC=F (COMEX Gold Futures) from Yahoo Finance for market hours
 */
import * as d3 from 'd3';
import { proxyUrl } from '@/utils/proxy';
import { getCurrentTheme } from '@/utils';
import { fetchAndAnalyzeSentiment, adjustPredictionWithSentiment, type SentimentResult } from '@/services/news-sentiment';

export type GoldTimeRange = '1h' | '6h' | '24h' | '7d';

export interface PredictionPoint {
  timestamp: Date;
  value: number;
}

export interface PredictionResult {
  points: PredictionPoint[];
  slope: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  sentimentAdjustment?: number; // Percentage adjustment from news sentiment
  sentimentSummary?: string;    // Brief explanation of sentiment impact
}

// Prediction configuration per timeframe
const PREDICTION_CONFIG: Record<GoldTimeRange, { lookback: number; projectionPoints: number; intervalMs: number }> = {
  '1h': { lookback: 30, projectionPoints: 3, intervalMs: 2 * 60 * 1000 },      // 3 x 2min = 6min ahead
  '6h': { lookback: 40, projectionPoints: 3, intervalMs: 5 * 60 * 1000 },      // 3 x 5min = 15min ahead
  '24h': { lookback: 48, projectionPoints: 3, intervalMs: 15 * 60 * 1000 },    // 3 x 15min = 45min ahead
  '7d': { lookback: 50, projectionPoints: 3, intervalMs: 60 * 60 * 1000 },     // 3 x 1hr = 3hr ahead
};

// Note: Prediction refreshes with main data refresh (every 60s) or on timeframe change

export interface GoldPriceDataPoint {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuickStats {
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
  weeklyHigh: number;
  weeklyLow: number;
  trend: 'bullish' | 'bearish' | 'neutral';
}

export interface GoldChartState {
  currentPrice: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  trend: 'bullish' | 'bearish' | 'neutral';
  data: GoldPriceDataPoint[];
  lastUpdated: Date | null;
  error: string | null;
  loading: boolean;
  quickStats: QuickStats | null;
  prediction: PredictionResult | null;
  sentiment: SentimentResult | null;
  dataSource: 'xaut' | 'yahoo'; // Track which data source is being used
}

const REFRESH_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Linear regression calculation for price prediction
 * Returns slope, intercept, and R-squared for confidence
 */
function linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, rSquared: 0 };

  // Use indices as x values (0, 1, 2, ...)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i]!;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
    sumY2 += y * y;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared (coefficient of determination)
  const yMean = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i]!;
    const yPred = slope * i + intercept;
    ssRes += (y - yPred) ** 2;
    ssTot += (y - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, rSquared };
}

export class GoldPriceChart {
  private container: HTMLElement;
  private state: GoldChartState;
  private chartContainer: HTMLElement | null = null;
  private timeRangeSelector: HTMLElement | null = null;
  private lastUpdatedDisplay: HTMLElement | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private currentTimeRange: GoldTimeRange = '1h';
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyCleanup: (() => void)[] = [];
  
  // Global 7D slope for synchronized predictions across timeframes
  private globalSlope: number = 0;
  
  // Sentiment display element
  private sentimentDisplay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.state = {
      currentPrice: null,
      previousClose: null,
      change: null,
      changePercent: null,
      trend: 'neutral',
      data: [],
      lastUpdated: null,
      error: null,
      loading: true,
      quickStats: null,
      prediction: null,
      sentiment: null,
      dataSource: 'xaut',
    };
  }

  async init(): Promise<void> {
    this.render();
    // Fetch sentiment and global slope in parallel
    await Promise.all([
      this.fetchGlobalSlope(),
      this.fetchSentiment(),
    ]);
    await this.fetchData();
    this.startAutoRefresh();
    this.setupResizeObserver();
  }

  /**
   * Fetch news sentiment for prediction adjustment
   */
  private async fetchSentiment(): Promise<void> {
    try {
      this.state.sentiment = await fetchAndAnalyzeSentiment();
      this.updateSentimentDisplay();
    } catch (err) {
      console.error('[GoldPriceChart] Failed to fetch sentiment:', err);
    }
  }

  /**
   * Fetch 7D data to calculate global slope for synchronized predictions
   */
  private async fetchGlobalSlope(): Promise<void> {
    try {
      const url = proxyUrl('/api/yahoo/v8/finance/chart/GC=F?interval=1h&range=5d');
      const response = await fetch(url);
      if (!response.ok) return;
      
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result?.timestamp || !result?.indicators?.quote?.[0]) return;
      
      const timestamps = result.timestamp as number[];
      const quote = result.indicators.quote[0];
      
      // Extract valid close prices
      const prices: number[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const close = quote.close?.[i];
        if (close && close > 0) {
          prices.push(close);
        }
      }
      
      if (prices.length < 20) return;
      
      // Calculate regression on 7D data
      const { slope } = linearRegression(prices);
      this.globalSlope = slope;
      
    } catch (err) {
      console.error('[GoldPriceChart] Failed to fetch global slope:', err);
    }
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="gold-chart-wrapper">
        <!-- Quick Stats Panel -->
        <div class="gold-quick-stats">
          <div class="quick-stat-card current-price">
            <span class="stat-label">Current Price</span>
            <span class="stat-value" data-stat="price">--</span>
          </div>
          <div class="quick-stat-card change-24h">
            <span class="stat-label">24h Change</span>
            <span class="stat-value" data-stat="change24h">--</span>
          </div>
          <div class="quick-stat-card weekly-range">
            <span class="stat-label">Weekly High / Low</span>
            <span class="stat-value" data-stat="weeklyRange">--</span>
          </div>
          <div class="quick-stat-card trend-indicator">
            <span class="stat-label">Trend</span>
            <span class="stat-value trend-badge neutral" data-stat="trend">NEUTRAL</span>
          </div>
        </div>
        <div class="gold-chart-header">
          <div class="gold-price-info">
            <div class="gold-symbol">
              <span class="gold-icon">🥇</span>
              <span class="gold-pair">GOLD</span>
              <span class="gold-label">Real-Time Price</span>
              <span class="gold-data-source-badge xaut" title="Live 24/7 Gold Price">🔴 LIVE 24/7</span>
            </div>
          </div>
          <div class="gold-sentiment-display" title="News sentiment impact on prediction">
            <span class="sentiment-label">News Sentiment</span>
            <span class="sentiment-badge neutral" data-sentiment="badge">ANALYZING...</span>
            <span class="sentiment-summary" data-sentiment="summary"></span>
          </div>
          <div class="gold-time-controls">
            <button class="time-range-btn active" data-range="1h">1H</button>
            <button class="time-range-btn" data-range="6h">6H</button>
            <button class="time-range-btn" data-range="24h">24H</button>
            <button class="time-range-btn" data-range="7d">7D</button>
            <span class="last-updated">--</span>
          </div>
        </div>
        <div class="gold-chart-container">
          <div class="gold-chart-loading">Loading Gold price data...</div>
        </div>
        <div class="gold-chart-footer">
          <div class="gold-prediction-note">
            <span class="prediction-note-icon">ℹ️</span>
            <span class="prediction-note-text">Predictions based on global trend (7D base) + news sentiment. Breaking news adjusts prediction slope in real-time.</span>
          </div>
          <div class="gold-disclaimer-ticker">
            <div class="ticker-content">
              <span>⚠️ DISCLAIMER: This dashboard is for informational purposes only. Not financial advice. Trading Gold involves high risk of loss. Past performance is not indicative of future results. Use at your own risk.</span>
              <span>⚠️ DISCLAIMER: This dashboard is for informational purposes only. Not financial advice. Trading Gold involves high risk of loss. Past performance is not indicative of future results. Use at your own risk.</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.chartContainer = this.container.querySelector('.gold-chart-container');
    this.lastUpdatedDisplay = this.container.querySelector('.last-updated');
    this.sentimentDisplay = this.container.querySelector('.gold-sentiment-display');
    this.timeRangeSelector = this.container.querySelector('.gold-time-controls');

    // Bind time range buttons
    this.timeRangeSelector?.querySelectorAll('.time-range-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        const range = target.dataset.range as GoldTimeRange;
        if (range && range !== this.currentTimeRange) {
          this.currentTimeRange = range;
          this.timeRangeSelector?.querySelectorAll('.time-range-btn').forEach((b) => b.classList.remove('active'));
          target.classList.add('active');
          this.fetchData();
        }
      });
    });
  }

  /**
   * Update sentiment display with current sentiment data
   */
  private updateSentimentDisplay(): void {
    if (!this.sentimentDisplay || !this.state.sentiment) return;
    
    const sentiment = this.state.sentiment;
    const badge = this.sentimentDisplay.querySelector('[data-sentiment="badge"]');
    const summary = this.sentimentDisplay.querySelector('[data-sentiment="summary"]');
    
    if (badge) {
      let label = 'NEUTRAL';
      let className = 'sentiment-badge neutral';
      
      if (sentiment.score > 0.3) {
        label = `BULLISH +${sentiment.adjustmentPercent.toFixed(1)}%`;
        className = 'sentiment-badge bullish';
      } else if (sentiment.score < -0.3) {
        label = `BEARISH ${sentiment.adjustmentPercent.toFixed(1)}%`;
        className = 'sentiment-badge bearish';
      } else if (sentiment.triggerWords.length > 0) {
        label = 'MIXED';
        className = 'sentiment-badge neutral';
      }
      
      badge.textContent = label;
      badge.className = className;
    }
    
    if (summary) {
      summary.textContent = sentiment.summary;
      summary.setAttribute('title', sentiment.triggerWords.join(', '));
    }
  }

  /**
   * Fetch XAUT/USDT data from CoinGecko API (24/7 crypto gold data)
   * Falls back to Yahoo Finance GC=F if CoinGecko fails
   */
  private async fetchData(): Promise<void> {
    this.state.loading = true;
    this.state.error = null;
    this.updateLoadingState();

    try {
      // Refresh sentiment on each data fetch
      void this.fetchSentiment();
      
      // Try CoinGecko XAUT/USDT first for 24/7 data
      const xautData = await this.fetchXautFromCoinGecko();
      
      if (xautData && xautData.length > 5) {
        this.state.data = xautData;
        this.state.dataSource = 'xaut';
        this.updateDataSourceBadge('xaut');
      } else {
        // Fallback to Yahoo Finance
        console.warn('[GoldPriceChart] CoinGecko failed, falling back to Yahoo Finance');
        await this.fetchFromYahooFinance();
        this.state.dataSource = 'yahoo';
        this.updateDataSourceBadge('yahoo');
      }

      // Calculate Quick Stats (always fetches 24h data independently)
      await this.fetchQuickStats();

      // Calculate current price and change
      if (this.state.data.length > 0) {
        const latest = this.state.data[this.state.data.length - 1]!;
        const first = this.state.data[0]!;
        this.state.currentPrice = latest.close;
        this.state.previousClose = first.open;
        this.state.change = latest.close - first.open;
        this.state.changePercent = ((latest.close - first.open) / first.open) * 100;
        
        // Calculate prediction using linear regression + sentiment adjustment
        this.state.prediction = this.calculatePrediction();
        
        // Use prediction trend for consistency between line direction and label
        this.state.trend = this.state.prediction?.trend ?? 'neutral';
      }

      this.state.lastUpdated = new Date();
      this.state.loading = false;
      this.state.error = null;

      this.updatePriceDisplay();
      this.updateQuickStatsDisplay();
      this.renderChart();
    } catch (err) {
      console.error('[GoldPriceChart] Fetch error:', err);
      this.state.loading = false;
      this.state.error = err instanceof Error ? err.message : 'Failed to fetch data';
      this.updateErrorState();
    }
  }

  /**
   * Fetch XAUT/USDT price data from CoinGecko API
   */
  private async fetchXautFromCoinGecko(): Promise<GoldPriceDataPoint[] | null> {
    try {
      // CoinGecko market chart endpoint for XAUT (Tether Gold)
      // Use days parameter based on time range
      const daysConfig: Record<GoldTimeRange, string> = {
        '1h': '1',   // Last 1 day, then filter to 1h
        '6h': '1',   // Last 1 day, then filter to 6h
        '24h': '1',  // Last 1 day
        '7d': '7',   // Last 7 days
      };
      
      const days = daysConfig[this.currentTimeRange];
      
      // CoinGecko API - tether-gold is the ID for XAUT
      const url = proxyUrl(`/api/coingecko/api/v3/coins/tether-gold/market_chart?vs_currency=usd&days=${days}`);
      
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(10000),
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.warn('[GoldPriceChart] CoinGecko response not ok:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      if (!data?.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
        console.warn('[GoldPriceChart] No prices from CoinGecko');
        return null;
      }
      
      // Convert CoinGecko format [timestamp, price] to our format
      const allPoints: GoldPriceDataPoint[] = data.prices.map((p: [number, number]) => ({
        timestamp: new Date(p[0]),
        open: p[1],
        high: p[1],
        low: p[1],
        close: p[1],
        volume: 0,
      }));
      
      // Filter to requested time range
      const cutoffConfig: Record<GoldTimeRange, number> = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
      };
      
      const now = Date.now();
      const cutoff = now - cutoffConfig[this.currentTimeRange];
      const filteredPoints = allPoints.filter(p => p.timestamp.getTime() >= cutoff);
      
      return filteredPoints.length > 0 ? filteredPoints : allPoints.slice(-60);
    } catch (err) {
      console.error('[GoldPriceChart] CoinGecko fetch error:', err);
      return null;
    }
  }

  /**
   * Fallback: Fetch from Yahoo Finance (GC=F Gold Futures)
   */
  private async fetchFromYahooFinance(): Promise<void> {
    // Yahoo Finance parameters based on time range
    const rangeConfig: Record<GoldTimeRange, { interval: string; range: string; cutoffMs: number }> = {
      '1h': { interval: '2m', range: '1d', cutoffMs: 60 * 60 * 1000 },
      '6h': { interval: '5m', range: '1d', cutoffMs: 6 * 60 * 60 * 1000 },
      '24h': { interval: '15m', range: '1d', cutoffMs: 24 * 60 * 60 * 1000 },
      '7d': { interval: '1h', range: '5d', cutoffMs: 7 * 24 * 60 * 60 * 1000 },
    };

    const config = rangeConfig[this.currentTimeRange];

    // Fetch chart data - using GC=F (COMEX Gold Futures tracks spot price closely)
    const url = proxyUrl(`/api/yahoo/v8/finance/chart/GC=F?interval=${config.interval}&range=${config.range}`);
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    // Parse Yahoo Finance chart response
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      throw new Error('No price data available');
    }

    const timestamps = result.timestamp as number[];
    const quote = result.indicators.quote[0];

    // Convert to array of data points
    const allPoints: GoldPriceDataPoint[] = timestamps
      .map((ts: number, i: number) => ({
        timestamp: new Date(ts * 1000),
        open: quote.open?.[i] ?? 0,
        high: quote.high?.[i] ?? 0,
        low: quote.low?.[i] ?? 0,
        close: quote.close?.[i] ?? 0,
        volume: quote.volume?.[i] ?? 0,
      }))
      .filter((p: GoldPriceDataPoint) => p.close > 0)
      .sort((a: GoldPriceDataPoint, b: GoldPriceDataPoint) => a.timestamp.getTime() - b.timestamp.getTime());

    // Filter to time range
    const now = new Date();
    const cutoff = new Date(now.getTime() - config.cutoffMs);
    const filteredPoints = allPoints.filter((p) => p.timestamp >= cutoff);

    this.state.data = filteredPoints.length > 0 ? filteredPoints : allPoints.slice(-60);
  }

  /**
   * Update the data source badge in the UI
   */
  private updateDataSourceBadge(source: 'xaut' | 'yahoo'): void {
    const badge = this.container.querySelector('.gold-data-source-badge');
    const pairEl = this.container.querySelector('.gold-pair');
    const labelEl = this.container.querySelector('.gold-label');
    
    if (source === 'xaut') {
      if (badge) {
        badge.textContent = '🔴 LIVE 24/7';
        badge.className = 'gold-data-source-badge xaut';
        badge.setAttribute('title', 'Live 24/7 Gold Price');
      }
      if (pairEl) pairEl.textContent = 'GOLD';
      if (labelEl) labelEl.textContent = 'Real-Time Price';
    } else {
      if (badge) {
        badge.textContent = '📊 MARKET HOURS';
        badge.className = 'gold-data-source-badge yahoo';
        badge.setAttribute('title', 'Gold Futures (24/5 market hours)');
      }
      if (pairEl) pairEl.textContent = 'GOLD';
      if (labelEl) labelEl.textContent = 'Futures Price';
    }
  }

  private async fetchQuickStats(): Promise<void> {
    try {
      // Fetch 24h data specifically for quick stats (independent of chart timeframe)
      // Use CoinGecko for 24/7 data consistency
      let data24h: Array<{ timestamp: Date; close: number; high: number; low: number }> = [];
      
      try {
        const url = proxyUrl(`/api/coingecko/api/v3/coins/tether-gold/market_chart?vs_currency=usd&days=7`);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        
        if (response.ok) {
          const data = await response.json();
          if (data?.prices && Array.isArray(data.prices)) {
            data24h = data.prices.map((p: [number, number]) => ({
              timestamp: new Date(p[0]),
              close: p[1],
              high: p[1],
              low: p[1],
            }));
          }
        }
      } catch {
        // Fall back to Yahoo Finance
      }
      
      // Fallback to Yahoo Finance if CoinGecko failed
      if (data24h.length === 0) {
        const weeklyUrl = proxyUrl(`/api/yahoo/v8/finance/chart/GC=F?interval=1h&range=5d`);
        const weeklyResponse = await fetch(weeklyUrl);
        
        if (weeklyResponse.ok) {
          const weeklyData = await weeklyResponse.json();
          const weeklyResult = weeklyData?.chart?.result?.[0];
          if (weeklyResult?.timestamp && weeklyResult?.indicators?.quote?.[0]) {
            const timestamps = weeklyResult.timestamp as number[];
            const quote = weeklyResult.indicators.quote[0];
            data24h = timestamps.map((ts: number, i: number) => ({
              timestamp: new Date(ts * 1000),
              close: quote.close?.[i] ?? 0,
              high: quote.high?.[i] ?? 0,
              low: quote.low?.[i] ?? 0,
            })).filter((p: { close: number }) => p.close > 0);
          }
        }
      }
      
      if (data24h.length === 0) {
        return; // No data available
      }

      // Calculate weekly high/low from 7-day data
      const now = new Date();
      const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last7d = data24h.filter((p) => p.timestamp >= cutoff7d);
      
      let weeklyHigh = 0;
      let weeklyLow = Infinity;
      
      for (const p of last7d) {
        if (p.high > weeklyHigh) weeklyHigh = p.high;
        if (p.low < weeklyLow && p.low > 0) weeklyLow = p.low;
      }

      // Calculate 24h change from 24h data
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last24h = data24h.filter((p) => p.timestamp >= cutoff24h);

      let change24h = 0;
      let changePercent24h = 0;
      let currentPrice = 0;

      if (last24h.length > 0) {
        const first = last24h[0]!;
        const latest = last24h[last24h.length - 1]!;
        currentPrice = latest.close;
        change24h = latest.close - first.close;
        changePercent24h = ((latest.close - first.close) / first.close) * 100;
      } else if (data24h.length > 0) {
        currentPrice = data24h[data24h.length - 1]!.close;
      }

      // Determine trend based on 24h price movement
      let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (changePercent24h > 0.3) {
        trend = 'bullish';
      } else if (changePercent24h < -0.3) {
        trend = 'bearish';
      }

      this.state.quickStats = {
        currentPrice,
        change24h,
        changePercent24h,
        weeklyHigh: weeklyHigh > 0 ? weeklyHigh : currentPrice,
        weeklyLow: weeklyLow < Infinity ? weeklyLow : currentPrice,
        trend,
      };
    } catch (err) {
      console.error('[GoldPriceChart] Quick stats fetch error:', err);
      // Quick stats are optional, don't fail the main fetch
    }
  }

  private updateQuickStatsDisplay(): void {
    const stats = this.state.quickStats;
    if (!stats) return;

    const priceEl = this.container.querySelector('[data-stat="price"]');
    const changeEl = this.container.querySelector('[data-stat="change24h"]');
    const weeklyEl = this.container.querySelector('[data-stat="weeklyRange"]');
    // Note: TREND badge is updated by updatePriceDisplay() using prediction trend
    // to keep it consistent with the prediction line direction

    if (priceEl) {
      priceEl.textContent = `$${stats.currentPrice.toFixed(2)}`;
    }

    if (changeEl) {
      const sign = stats.change24h >= 0 ? '+' : '';
      changeEl.textContent = `${sign}$${stats.change24h.toFixed(2)} (${sign}${stats.changePercent24h.toFixed(2)}%)`;
      changeEl.className = `stat-value ${stats.change24h >= 0 ? 'positive' : 'negative'}`;
    }

    if (weeklyEl) {
      weeklyEl.textContent = `$${stats.weeklyHigh.toFixed(2)} / $${stats.weeklyLow.toFixed(2)}`;
    }
  }

  /**
   * Calculate price prediction using linear regression
   * Projects future price points based on recent trend, blended with global 7D slope
   * ENHANCED: Integrates news sentiment to adjust prediction for breaking news
   */
  private calculatePrediction(): PredictionResult | null {
    const config = PREDICTION_CONFIG[this.currentTimeRange];
    const data = this.state.data;
    
    if (data.length < 10) return null; // Need minimum data points
    
    // Get the lookback period for regression
    const lookbackData = data.slice(-Math.min(config.lookback, data.length));
    const prices = lookbackData.map(d => d.close);
    
    // Calculate local linear regression
    const { slope: localSlope, rSquared } = linearRegression(prices);
    
    // Blend local slope with global 7D slope for consistency
    // Weight: 7D uses 100% local, shorter timeframes blend more with global
    const blendWeights: Record<GoldTimeRange, number> = {
      '1h': 0.3,  // 30% local, 70% global
      '6h': 0.5,  // 50% local, 50% global
      '24h': 0.7, // 70% local, 30% global
      '7d': 1.0,  // 100% local (this IS the global reference)
    };
    
    const localWeight = blendWeights[this.currentTimeRange];
    const globalWeight = 1 - localWeight;
    
    // Convert global slope (per hour) to local timeframe scale
    // Global slope is per 1-hour intervals, scale to local interval
    const localIntervalHours = config.intervalMs / (60 * 60 * 1000);
    const scaledGlobalSlope = this.globalSlope * localIntervalHours;
    
    // Blend the slopes
    let blendedSlope = (localSlope * localWeight) + (scaledGlobalSlope * globalWeight);
    
    // ====== NEWS SENTIMENT ADJUSTMENT ======
    // Apply sentiment-based adjustment to the slope
    // Positive sentiment (geopolitical risk, etc.) pushes gold up
    // Negative sentiment (risk-on, strong dollar) pushes gold down
    let sentimentAdjustment = 0;
    let sentimentSummary = '';
    
    if (this.state.sentiment && this.state.sentiment.confidence >= 0.3) {
      const sentiment = this.state.sentiment;
      
      // Apply adjustment: sentiment adjustmentPercent (-3% to +3%) 
      // Scale to slope adjustment: 1% price change = slope adjustment
      const lastPoint = data[data.length - 1]!;
      const priceAdjustment = lastPoint.close * (sentiment.adjustmentPercent / 100);
      
      // Distribute the adjustment across projection points
      // This effectively steepens/flattens the prediction line
      const slopeAdjustment = priceAdjustment / config.projectionPoints;
      blendedSlope += slopeAdjustment;
      
      sentimentAdjustment = sentiment.adjustmentPercent;
      sentimentSummary = sentiment.summary;
      
      console.log('[GoldPriceChart] Sentiment adjustment applied:',
        sentiment.adjustmentPercent.toFixed(2) + '%',
        sentiment.summary);
    }
    
    // Get the last data point as starting point
    const lastPoint = data[data.length - 1]!;
    const lastTimestamp = lastPoint.timestamp.getTime();
    
    // Generate prediction points using blended slope (with sentiment adjustment)
    const points: PredictionPoint[] = [];
    
    // First point connects to the last historical point
    points.push({
      timestamp: lastPoint.timestamp,
      value: lastPoint.close,
    });
    
    // Generate future prediction points using adjusted slope
    for (let i = 1; i <= config.projectionPoints; i++) {
      const futureTimestamp = new Date(lastTimestamp + i * config.intervalMs);
      // Project using blended slope from current price
      let projectedValue = lastPoint.close + (blendedSlope * i);
      
      // Apply sentiment adjustment to final prediction
      if (sentimentAdjustment !== 0) {
        projectedValue = adjustPredictionWithSentiment(projectedValue, this.state.sentiment!);
      }
      
      points.push({
        timestamp: futureTimestamp,
        value: projectedValue,
      });
    }
    
    // Determine trend direction based on slope (including sentiment adjustment)
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    
    // Calculate total predicted change from current price to final prediction
    const lastPredPoint = points[points.length - 1]!;
    const totalChange = lastPredPoint.value - lastPoint.close;
    const totalChangePercent = (totalChange / lastPoint.close) * 100;
    
    // Use 0.05% total change threshold for trend detection
    // Sentiment can push a neutral trend into bullish/bearish territory
    if (totalChangePercent > 0.05) {
      trend = 'bullish';
    } else if (totalChangePercent < -0.05) {
      trend = 'bearish';
    }
    
    return {
      points,
      slope: blendedSlope,
      trend,
      confidence: Math.max(0, Math.min(1, rSquared)), // Clamp to 0-1
      sentimentAdjustment,
      sentimentSummary,
    };
  }

  private updatePriceDisplay(): void {
    // Update trend badge in quick stats
    const trendBadge = this.container.querySelector('[data-stat="trend"]');
    if (trendBadge) {
      trendBadge.textContent = this.state.trend.toUpperCase();
      trendBadge.className = `stat-value trend-badge ${this.state.trend}`;
    }

    // Update last updated timestamp
    if (this.lastUpdatedDisplay && this.state.lastUpdated) {
      this.lastUpdatedDisplay.textContent = `Updated: ${this.state.lastUpdated.toLocaleTimeString()}`;
    }
  }

  private updateLoadingState(): void {
    if (this.chartContainer) {
      this.chartContainer.innerHTML = '<div class="gold-chart-loading">Loading gold price data...</div>';
    }
  }

  private updateErrorState(): void {
    if (this.chartContainer) {
      this.chartContainer.innerHTML = `<div class="gold-chart-error">
        <span class="error-icon">⚠️</span>
        <span>${this.state.error || 'Error loading data'}</span>
        <button class="retry-btn">Retry</button>
      </div>`;

      this.chartContainer.querySelector('.retry-btn')?.addEventListener('click', () => {
        this.fetchData();
      });
    }
  }

  private renderChart(): void {
    if (!this.chartContainer || this.state.data.length === 0) return;

    // Clear previous chart
    this.chartContainer.innerHTML = '';

    const isDarkTheme = getCurrentTheme() === 'dark';
    // Gold theme colors - enhanced for trading focus
    const colors = {
      line: '#FFD700', // Primary gold
      lineGradientStart: 'rgba(255, 215, 0, 0.4)',
      lineGradientEnd: 'rgba(255, 215, 0, 0.02)',
      grid: isDarkTheme ? 'rgba(48, 54, 61, 0.8)' : 'rgba(0, 0, 0, 0.1)',
      axis: isDarkTheme ? 'rgba(139, 148, 158, 0.6)' : 'rgba(0, 0, 0, 0.5)',
      text: isDarkTheme ? '#8b949e' : '#666666',
      tooltip: isDarkTheme ? '#161b22' : '#ffffff',
      tooltipBorder: isDarkTheme ? '#FFD700' : '#B8860B',
    };

    const containerRect = this.chartContainer.getBoundingClientRect();
    const margin = { top: 20, right: 60, bottom: 30, left: 10 };
    const width = containerRect.width - margin.left - margin.right;
    const height = containerRect.height - margin.top - margin.bottom;

    if (width <= 0 || height <= 0) return;

    // Create SVG
    this.svg = d3
      .select(this.chartContainer)
      .append('svg')
      .attr('width', containerRect.width)
      .attr('height', containerRect.height)
      .attr('class', 'gold-price-svg');

    const g = this.svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales - extend to include prediction points
    let xDomain = d3.extent(this.state.data, (d) => d.timestamp) as [Date, Date];
    let yMin = d3.min(this.state.data, (d) => d.close) ?? 0;
    let yMax = d3.max(this.state.data, (d) => d.close) ?? 0;
    
    // Extend domain if prediction exists
    const prediction = this.state.prediction;
    if (prediction && prediction.points.length > 1) {
      const lastPrediction = prediction.points[prediction.points.length - 1]!;
      xDomain = [xDomain[0], lastPrediction.timestamp];
      const predMin = Math.min(...prediction.points.map(p => p.value));
      const predMax = Math.max(...prediction.points.map(p => p.value));
      yMin = Math.min(yMin, predMin);
      yMax = Math.max(yMax, predMax);
    }
    
    const xScale = d3
      .scaleTime()
      .domain(xDomain)
      .range([0, width]);

    const yPadding = (yMax - yMin) * 0.1 || 10;
    const yScale = d3
      .scaleLinear()
      .domain([yMin - yPadding, yMax + yPadding])
      .range([height, 0]);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', colors.grid)
      .attr('stroke-dasharray', '2,2');

    // Gradient for area fill
    const gradientId = 'gold-area-gradient';
    const defs = this.svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', gradientId).attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', colors.lineGradientStart);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', colors.lineGradientEnd);

    // Area
    const area = d3
      .area<GoldPriceDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y0(height)
      .y1((d) => yScale(d.close))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(this.state.data)
      .attr('class', 'gold-area')
      .attr('fill', `url(#${gradientId})`)
      .attr('d', area);

    // Line
    const line = d3
      .line<GoldPriceDataPoint>()
      .x((d) => xScale(d.timestamp))
      .y((d) => yScale(d.close))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(this.state.data)
      .attr('class', 'gold-line')
      .attr('fill', 'none')
      .attr('stroke', colors.line)
      .attr('stroke-width', 2)
      .attr('d', line);

    // Prediction Line - dashed projection of future prices
    if (prediction && prediction.points.length > 1) {
      const isDark = isDarkTheme;
      const predictionColor = prediction.trend === 'bullish' 
        ? '#00ff88' 
        : prediction.trend === 'bearish' 
          ? '#ff4444' 
          : (isDark ? '#ffffff' : '#FFD700');
      
      const predictionLine = d3
        .line<PredictionPoint>()
        .x((d) => xScale(d.timestamp))
        .y((d) => yScale(d.value))
        .curve(d3.curveLinear);

      g.append('path')
        .datum(prediction.points)
        .attr('class', 'prediction-line')
        .attr('fill', 'none')
        .attr('stroke', predictionColor)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5, 5')
        .attr('d', predictionLine);
      
      // Add prediction endpoint marker
      const lastPred = prediction.points[prediction.points.length - 1]!;
      g.append('circle')
        .attr('class', 'prediction-endpoint')
        .attr('cx', xScale(lastPred.timestamp))
        .attr('cy', yScale(lastPred.value))
        .attr('r', 4)
        .attr('fill', predictionColor)
        .attr('stroke', isDark ? '#000' : '#fff')
        .attr('stroke-width', 1);
      
      // Add prediction label
      const labelX = xScale(lastPred.timestamp);
      const labelY = yScale(lastPred.value) - 12;
      const trendLabel = prediction.trend === 'bullish' ? '↑' : prediction.trend === 'bearish' ? '↓' : '→';
      const confidencePercent = Math.round(prediction.confidence * 100);
      
      g.append('text')
        .attr('class', 'prediction-label')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', predictionColor)
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .text(`${trendLabel} $${lastPred.value.toFixed(2)} (${confidencePercent}%)`);
      
      // Add "Predicted Trend" legend in bottom right
      g.append('text')
        .attr('class', 'prediction-legend')
        .attr('x', width - 10)
        .attr('y', height - 10)
        .attr('text-anchor', 'end')
        .attr('fill', colors.text)
        .attr('font-size', '9px')
        .attr('font-style', 'italic')
        .text('--- Predicted Trend');
    }

    // X Axis
    const xAxis = d3.axisBottom(xScale).ticks(this.currentTimeRange === '1h' ? 6 : 8).tickFormat((d) => {
      const date = d as Date;
      return this.currentTimeRange === '1h'
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', colors.text)
      .attr('font-size', '11px');

    g.selectAll('.x-axis path, .x-axis line').attr('stroke', colors.axis);

    // Y Axis (on right side)
    const yAxis = d3.axisRight(yScale).ticks(5).tickFormat((d) => `$${d3.format(',.0f')(d as number)}`);

    g.append('g')
      .attr('class', 'y-axis')
      .attr('transform', `translate(${width},0)`)
      .call(yAxis)
      .selectAll('text')
      .attr('fill', colors.text)
      .attr('font-size', '11px');

    g.selectAll('.y-axis path, .y-axis line').attr('stroke', colors.axis);

    // Tooltip / Crosshair interaction
    this.setupTooltip(g, xScale, yScale, width, height, colors);
  }

  private setupTooltip(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    xScale: d3.ScaleTime<number, number>,
    yScale: d3.ScaleLinear<number, number>,
    width: number,
    height: number,
    colors: { line: string; axis: string; text: string; tooltip: string; tooltipBorder: string }
  ): void {
    const bisect = d3.bisector<GoldPriceDataPoint, Date>((d) => d.timestamp).left;

    const focus = g.append('g').attr('class', 'focus').style('display', 'none');

    focus.append('circle').attr('r', 5).attr('fill', colors.line).attr('stroke', '#fff').attr('stroke-width', 2);

    focus.append('line').attr('class', 'focus-line-x').attr('stroke', colors.axis).attr('stroke-dasharray', '3,3').attr('opacity', 0.5);

    focus.append('line').attr('class', 'focus-line-y').attr('stroke', colors.axis).attr('stroke-dasharray', '3,3').attr('opacity', 0.5);

    const tooltip = g
      .append('g')
      .attr('class', 'tooltip-group')
      .style('display', 'none');

    tooltip
      .append('rect')
      .attr('class', 'tooltip-bg')
      .attr('fill', colors.tooltip)
      .attr('stroke', colors.tooltipBorder)
      .attr('rx', 4)
      .attr('ry', 4);

    tooltip.append('text').attr('class', 'tooltip-price').attr('fill', colors.line).attr('font-size', '12px').attr('font-weight', 'bold');

    tooltip.append('text').attr('class', 'tooltip-time').attr('fill', colors.text).attr('font-size', '10px');

    const overlay = g
      .append('rect')
      .attr('class', 'overlay')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'transparent');

    overlay.on('mouseover', () => {
      focus.style('display', null);
      tooltip.style('display', null);
    });

    overlay.on('mouseout', () => {
      focus.style('display', 'none');
      tooltip.style('display', 'none');
    });

    overlay.on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      const x0 = xScale.invert(mx);
      const i = bisect(this.state.data, x0, 1);
      const d0 = this.state.data[i - 1];
      const d1 = this.state.data[i];

      if (!d0 || !d1) return;

      const d = x0.getTime() - d0.timestamp.getTime() > d1.timestamp.getTime() - x0.getTime() ? d1 : d0;

      const cx = xScale(d.timestamp);
      const cy = yScale(d.close);

      focus.attr('transform', `translate(${cx},${cy})`);

      focus.select('.focus-line-x').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', height - cy);

      focus.select('.focus-line-y').attr('x1', 0).attr('y1', 0).attr('x2', width - cx).attr('y2', 0);

      // Position tooltip
      const tooltipX = cx + 15;
      const tooltipY = cy - 30;
      tooltip.attr('transform', `translate(${tooltipX},${tooltipY})`);

      tooltip.select('.tooltip-price').attr('x', 8).attr('y', 16).text(`$${d.close.toFixed(2)}`);

      tooltip
        .select('.tooltip-time')
        .attr('x', 8)
        .attr('y', 30)
        .text(d.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      tooltip.select('.tooltip-bg').attr('width', 90).attr('height', 40);
    });
  }

  private setupResizeObserver(): void {
    if (this.chartContainer) {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.state.loading && this.state.data.length > 0) {
          this.renderChart();
        }
      });
      this.resizeObserver.observe(this.chartContainer);

      this.destroyCleanup.push(() => {
        this.resizeObserver?.disconnect();
      });
    }
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => {
      this.fetchData();
    }, REFRESH_INTERVAL_MS);

    this.destroyCleanup.push(() => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
      }
    });
  }

  public destroy(): void {
    this.destroyCleanup.forEach((cleanup) => cleanup());
    this.destroyCleanup = [];
    this.container.innerHTML = '';
  }

  public refresh(): void {
    this.fetchData();
  }

  public setTimeRange(range: GoldTimeRange): void {
    if (range !== this.currentTimeRange) {
      this.currentTimeRange = range;
      this.fetchData();
    }
  }

  public getState(): GoldChartState {
    return { ...this.state };
  }
}
