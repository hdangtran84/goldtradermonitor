/**
 * News Sentiment Service for Gold Trading
 * Analyzes news headlines for impact on Gold prices and adjusts predictions.
 * 
 * Gold is a safe-haven asset that typically rises during:
 * - Geopolitical tensions/wars
 * - Inflation concerns
 * - Currency weakness (especially USD)
 * - Central bank dovishness
 * - Market uncertainty/crashes
 */

import { proxyUrl } from '@/utils/proxy';

export interface SentimentResult {
  score: number;          // -1.0 to +1.0 (negative = bearish, positive = bullish for gold)
  adjustmentPercent: number; // Suggested price adjustment (-3% to +3%)
  confidence: number;     // 0 to 1
  triggerWords: string[]; // Words that triggered the sentiment
  summary: string;        // Brief explanation
  headlines: string[];    // Headlines analyzed
  lastUpdated: Date;
}

// Keywords that indicate bullish sentiment for Gold
const BULLISH_KEYWORDS = [
  // Geopolitical - Gold rises as safe haven
  'war', 'attack', 'missile', 'military', 'invasion', 'conflict', 'tension',
  'iran', 'israel', 'russia', 'ukraine', 'china', 'taiwan', 'north korea',
  'strike', 'bomb', 'escalation', 'sanctions', 'retaliation',
  // Economic uncertainty - Gold rises
  'crash', 'crisis', 'recession', 'collapse', 'panic', 'fear', 'uncertainty',
  'default', 'bankruptcy', 'layoff', 'downturn',
  // Inflation - Gold as inflation hedge
  'inflation', 'cpi', 'rising prices', 'cost of living', 'stagflation',
  // Dollar weakness - Inverse correlation
  'dollar weak', 'dollar fall', 'dxy down', 'dollar decline', 'usd falls',
  // Central bank dovish - Lower rates = Gold up
  'rate cut', 'dovish', 'quantitative easing', 'qe', 'stimulus',
  'lower rates', 'money printing', 'fed pause',
  // Gold-specific bullish
  'gold rally', 'gold surge', 'gold record', 'gold high', 'gold demand',
  'central bank buying', 'gold reserves', 'safe haven', 'safe-haven',
  'gold etf inflow', 'gold price up', 'gold bullish',
  // Market stress
  'volatility', 'vix spike', 'risk off', 'flight to safety',
];

// Keywords that indicate bearish sentiment for Gold
const BEARISH_KEYWORDS = [
  // Strong dollar - Inverse correlation
  'dollar strength', 'dxy up', 'dollar rally', 'strong dollar', 'usd rises',
  // Hawkish Fed - Higher rates = Gold down
  'rate hike', 'hawkish', 'taper', 'tightening', 'inflation cool',
  'fed raise', 'higher rates', 'interest rate increase',
  // Risk-on sentiment - Stocks up = Gold down
  'market rally', 'stocks surge', 'risk on', 'bull market', 'optimism',
  'economic growth', 'recovery', 'strong jobs', 'low unemployment',
  // Gold-specific bearish
  'gold fall', 'gold drop', 'gold decline', 'gold selloff', 'gold outflow',
  'gold bearish', 'gold price down', 'gold etf outflow',
  // Peace/stability
  'ceasefire', 'peace deal', 'de-escalation', 'resolution', 'stability',
];

// Weight multipliers for high-impact events
const HIGH_IMPACT_MULTIPLIERS: Record<string, number> = {
  'iran': 1.5,
  'israel': 1.5,
  'war': 2.0,
  'attack': 1.8,
  'missile': 1.7,
  'nuclear': 2.0,
  'rate cut': 1.5,
  'rate hike': 1.5,
  'recession': 1.8,
  'crash': 1.8,
  'fed': 1.3,
};

// Cached sentiment result
let cachedSentiment: SentimentResult | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cacheTimestamp = 0;

/**
 * Analyze a single headline for gold sentiment
 */
function analyzeHeadline(headline: string): { score: number; weight: number; triggers: string[] } {
  const lower = headline.toLowerCase();
  let score = 0;
  let weight = 1;
  const triggers: string[] = [];
  
  // Check bullish keywords
  for (const keyword of BULLISH_KEYWORDS) {
    if (lower.includes(keyword)) {
      const multiplier = HIGH_IMPACT_MULTIPLIERS[keyword] || 1;
      score += 0.3 * multiplier;
      weight = Math.max(weight, multiplier);
      triggers.push(`+${keyword}`);
    }
  }
  
  // Check bearish keywords
  for (const keyword of BEARISH_KEYWORDS) {
    if (lower.includes(keyword)) {
      const multiplier = HIGH_IMPACT_MULTIPLIERS[keyword] || 1;
      score -= 0.3 * multiplier;
      weight = Math.max(weight, multiplier);
      triggers.push(`-${keyword}`);
    }
  }
  
  // Clamp score to -1 to 1
  score = Math.max(-1, Math.min(1, score));
  
  return { score, weight, triggers };
}

/**
 * Analyze multiple headlines and compute aggregate sentiment
 */
export function analyzeHeadlines(headlines: string[]): SentimentResult {
  if (headlines.length === 0) {
    return {
      score: 0,
      adjustmentPercent: 0,
      confidence: 0,
      triggerWords: [],
      summary: 'No headlines to analyze',
      headlines: [],
      lastUpdated: new Date(),
    };
  }
  
  let totalScore = 0;
  let totalWeight = 0;
  const allTriggers: string[] = [];
  
  for (const headline of headlines) {
    const result = analyzeHeadline(headline);
    totalScore += result.score * result.weight;
    totalWeight += result.weight;
    allTriggers.push(...result.triggers);
  }
  
  const avgScore = totalWeight > 0 ? totalScore / totalWeight : 0;
  
  // Calculate adjustment percent (-3% to +3% based on score)
  const adjustmentPercent = avgScore * 3;
  
  // Confidence based on number of triggers and consistency
  const triggerCount = allTriggers.length;
  const confidence = Math.min(1, triggerCount / (headlines.length * 2));
  
  // Generate summary
  let summary = 'Neutral sentiment';
  if (avgScore > 0.3) {
    summary = `Bullish for Gold: ${allTriggers.filter(t => t.startsWith('+')).slice(0, 3).join(', ')}`;
  } else if (avgScore < -0.3) {
    summary = `Bearish for Gold: ${allTriggers.filter(t => t.startsWith('-')).slice(0, 3).join(', ')}`;
  } else if (allTriggers.length > 0) {
    summary = 'Mixed signals - neutral stance';
  }
  
  return {
    score: avgScore,
    adjustmentPercent,
    confidence,
    triggerWords: [...new Set(allTriggers)].slice(0, 10),
    summary,
    headlines: headlines.slice(0, 10),
    lastUpdated: new Date(),
  };
}

/**
 * Fetch latest headlines from GDELT and analyze sentiment
 * Uses dedicated /api/gdelt-sentiment endpoint for production compatibility
 */
export async function fetchAndAnalyzeSentiment(): Promise<SentimentResult> {
  // Check cache
  if (cachedSentiment && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedSentiment;
  }
  
  try {
    // Use dedicated serverless function for GDELT that works in both dev and production
    const query = 'gold OR XAUUSD OR "gold price" OR geopolitical OR "Federal Reserve" OR inflation';
    const url = proxyUrl(`/api/gdelt-sentiment?query=${encodeURIComponent(query)}&maxrecords=30`);
    
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(10000) 
    });
    
    if (!response.ok) {
      console.warn('[NewsSentiment] GDELT fetch failed, using fallback');
      return getFallbackSentiment();
    }
    
    const data = await response.json();
    const articles = data?.articles || [];
    
    const headlines = articles
      .map((a: { title?: string }) => a.title)
      .filter((t: unknown): t is string => typeof t === 'string' && t.length > 10)
      .slice(0, 30);
    
    if (headlines.length === 0) {
      return getFallbackSentiment();
    }
    
    const result = analyzeHeadlines(headlines);
    
    // Cache result
    cachedSentiment = result;
    cacheTimestamp = Date.now();
    
    return result;
  } catch (error) {
    console.error('[NewsSentiment] Error fetching sentiment:', error);
    return getFallbackSentiment();
  }
}

function getFallbackSentiment(): SentimentResult {
  // Return cached if available but expired
  if (cachedSentiment) {
    return { ...cachedSentiment, confidence: cachedSentiment.confidence * 0.5 };
  }
  
  // Return neutral sentiment when no data available
  // Don't show error - just show neutral state
  return {
    score: 0,
    adjustmentPercent: 0,
    confidence: 0,
    triggerWords: [],
    summary: '',  // Empty summary = no tooltip/error message
    headlines: [],
    lastUpdated: new Date(),
  };
}

/**
 * Get the cached sentiment without fetching
 */
export function getCachedSentiment(): SentimentResult | null {
  return cachedSentiment;
}

/**
 * Clear sentiment cache (useful for forcing refresh)
 */
export function clearSentimentCache(): void {
  cachedSentiment = null;
  cacheTimestamp = 0;
}

/**
 * Adjust a prediction based on current news sentiment
 * @param baseValue The base predicted value
 * @param sentimentResult The analyzed sentiment
 * @returns Adjusted value with sentiment impact
 */
export function adjustPredictionWithSentiment(
  baseValue: number,
  sentimentResult: SentimentResult
): number {
  // Only apply adjustment if confidence is sufficient
  if (sentimentResult.confidence < 0.3) {
    return baseValue;
  }
  
  // Apply adjustment (capped at 3%)
  const adjustmentFactor = 1 + (sentimentResult.adjustmentPercent / 100);
  return baseValue * adjustmentFactor;
}
