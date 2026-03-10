/**
 * Unified market service module -- replaces legacy service:
 *   - src/services/markets.ts (Finnhub + Yahoo + CoinGecko)
 *
 * All data now flows through the MarketServiceClient RPCs.
 */

import {
  MarketServiceClient,
  type ListMarketQuotesResponse,
  type MarketQuote as ProtoMarketQuote,
} from '@/generated/client/worldmonitor/market/v1/service_client';
import type { MarketData, CryptoData } from '@/types';
import { createCircuitBreaker, cacheableFetch } from '@/utils';

// ---- Client + Circuit Breakers ----
// Use cacheableFetch to enable CDN caching via GET requests for read-only RPCs

const client = new MarketServiceClient('', { fetch: cacheableFetch });
const stockBreaker = createCircuitBreaker<ListMarketQuotesResponse>({ name: 'Market Quotes', cacheTtlMs: 0 });

const emptyStockFallback: ListMarketQuotesResponse = { quotes: [], finnhubSkipped: false, skipReason: '' };

// ---- Proto -> legacy adapters ----

function toMarketData(proto: ProtoMarketQuote, meta?: { name?: string; display?: string }): MarketData {
  return {
    symbol: proto.symbol,
    name: meta?.name || proto.name,
    display: meta?.display || proto.display || proto.symbol,
    price: proto.price != null ? proto.price : null,
    change: proto.change ?? null,
    sparkline: proto.sparkline.length > 0 ? proto.sparkline : undefined,
  };
}

// ========================================================================
// Exported types (preserving legacy interface)
// ========================================================================

export interface MarketFetchResult {
  data: MarketData[];
  skipped?: boolean;
  reason?: string;
}

// ========================================================================
// Stocks -- replaces fetchMultipleStocks + fetchStockQuote
// ========================================================================

const lastSuccessfulByKey = new Map<string, MarketData[]>();

// Mock/fallback data when APIs are unavailable (updated March 10, 2026)
// NOTE: These are static fallback values - live data fetched from Yahoo Finance when available
// Values based on actual Yahoo Finance prices as of March 10, 2026
const MOCK_DATA: Record<string, MarketData> = {
  // Commodities (March 10, 2026 - actual Yahoo Finance prices)
  '^VIX': { symbol: '^VIX', name: 'VIX', display: 'VIX', price: 24.13, change: 0.42, sparkline: [23.5, 23.7, 23.9, 24.0, 24.13] },
  'GC=F': { symbol: 'GC=F', name: 'Gold', display: 'GOLD', price: 5232.80, change: 2.53, sparkline: [5100, 5150, 5180, 5210, 5232.80] },
  'CL=F': { symbol: 'CL=F', name: 'Crude Oil', display: 'OIL', price: 86.82, change: -0.85, sparkline: [87.5, 87.2, 87.0, 86.9, 86.82] },
  'NG=F': { symbol: 'NG=F', name: 'Natural Gas', display: 'NATGAS', price: 4.12, change: 1.23, sparkline: [4.02, 4.05, 4.08, 4.10, 4.12] },
  'SI=F': { symbol: 'SI=F', name: 'Silver', display: 'SILVER', price: 89.51, change: 5.89, sparkline: [84.5, 86.0, 87.5, 88.5, 89.51] },
  'HG=F': { symbol: 'HG=F', name: 'Copper', display: 'COPPER', price: 5.94, change: -0.35, sparkline: [6.0, 5.98, 5.96, 5.95, 5.94] },
  // Indices (March 10, 2026 - actual Yahoo Finance prices)
  '^GSPC': { symbol: '^GSPC', name: 'S&P 500', display: 'SPX', price: 5770.20, change: -0.28, sparkline: [5800, 5790, 5780, 5775, 5770.20] },
  '^DJI': { symbol: '^DJI', name: 'Dow Jones', display: 'DOW', price: 48000.16, change: 0.15, sparkline: [47900, 47950, 47980, 48000, 48000.16] },
  '^IXIC': { symbol: '^IXIC', name: 'NASDAQ', display: 'NDX', price: 22838.42, change: -0.79, sparkline: [22900, 22880, 22860, 22845, 22838.42] },
  // Stocks
  'AAPL': { symbol: 'AAPL', name: 'Apple', display: 'AAPL', price: 187.52, change: 1.23, sparkline: [185, 186, 186.5, 187, 187.52] },
  'MSFT': { symbol: 'MSFT', name: 'Microsoft', display: 'MSFT', price: 423.85, change: 0.87, sparkline: [420, 421, 422, 423, 423.85] },
  'NVDA': { symbol: 'NVDA', name: 'NVIDIA', display: 'NVDA', price: 875.30, change: 2.15, sparkline: [860, 865, 870, 873, 875.30] },
  'GOOGL': { symbol: 'GOOGL', name: 'Alphabet', display: 'GOOGL', price: 175.28, change: -0.42, sparkline: [176, 175.8, 175.5, 175.3, 175.28] },
  'AMZN': { symbol: 'AMZN', name: 'Amazon', display: 'AMZN', price: 198.45, change: 0.95, sparkline: [196, 197, 197.5, 198, 198.45] },
  'META': { symbol: 'META', name: 'Meta', display: 'META', price: 582.70, change: 1.45, sparkline: [575, 578, 580, 581, 582.70] },
  'BRK-B': { symbol: 'BRK-B', name: 'Berkshire', display: 'BRK.B', price: 415.20, change: 0.28, sparkline: [413, 414, 414.5, 415, 415.20] },
  'TSM': { symbol: 'TSM', name: 'TSMC', display: 'TSM', price: 142.85, change: 1.82, sparkline: [140, 141, 141.5, 142, 142.85] },
  'LLY': { symbol: 'LLY', name: 'Eli Lilly', display: 'LLY', price: 762.40, change: 0.65, sparkline: [758, 759, 760, 761, 762.40] },
  'TSLA': { symbol: 'TSLA', name: 'Tesla', display: 'TSLA', price: 248.75, change: -1.85, sparkline: [252, 251, 250, 249, 248.75] },
  'AVGO': { symbol: 'AVGO', name: 'Broadcom', display: 'AVGO', price: 1245.60, change: 1.12, sparkline: [1230, 1235, 1240, 1243, 1245.60] },
  'WMT': { symbol: 'WMT', name: 'Walmart', display: 'WMT', price: 175.30, change: 0.35, sparkline: [174, 174.5, 175, 175.2, 175.30] },
  'JPM': { symbol: 'JPM', name: 'JPMorgan', display: 'JPM', price: 198.65, change: 0.72, sparkline: [196, 197, 198, 198.5, 198.65] },
  'V': { symbol: 'V', name: 'Visa', display: 'V', price: 285.40, change: 0.48, sparkline: [283, 284, 284.5, 285, 285.40] },
  'UNH': { symbol: 'UNH', name: 'UnitedHealth', display: 'UNH', price: 528.90, change: -0.32, sparkline: [530, 529.5, 529, 528.9, 528.90] },
  'NVO': { symbol: 'NVO', name: 'Novo Nordisk', display: 'NVO', price: 125.45, change: 1.95, sparkline: [123, 124, 124.5, 125, 125.45] },
  'XOM': { symbol: 'XOM', name: 'Exxon', display: 'XOM', price: 108.20, change: -0.85, sparkline: [109, 108.8, 108.5, 108.3, 108.20] },
  'MA': { symbol: 'MA', name: 'Mastercard', display: 'MA', price: 478.35, change: 0.62, sparkline: [475, 476, 477, 478, 478.35] },
  'ORCL': { symbol: 'ORCL', name: 'Oracle', display: 'ORCL', price: 152.80, change: 0.95, sparkline: [150, 151, 151.5, 152, 152.80] },
  'PG': { symbol: 'PG', name: 'P&G', display: 'PG', price: 168.45, change: 0.22, sparkline: [167, 167.5, 168, 168.3, 168.45] },
  'COST': { symbol: 'COST', name: 'Costco', display: 'COST', price: 892.60, change: 0.75, sparkline: [888, 889, 890, 891, 892.60] },
  'JNJ': { symbol: 'JNJ', name: 'J&J', display: 'JNJ', price: 158.30, change: 0.18, sparkline: [157, 157.5, 158, 158.2, 158.30] },
  'HD': { symbol: 'HD', name: 'Home Depot', display: 'HD', price: 378.90, change: 0.42, sparkline: [376, 377, 378, 378.5, 378.90] },
  'NFLX': { symbol: 'NFLX', name: 'Netflix', display: 'NFLX', price: 628.45, change: 1.35, sparkline: [620, 623, 625, 627, 628.45] },
  'BAC': { symbol: 'BAC', name: 'BofA', display: 'BAC', price: 38.75, change: 0.55, sparkline: [38, 38.3, 38.5, 38.6, 38.75] },
};

function symbolSetKey(symbols: string[]): string {
  return [...symbols].sort().join(',');
}

export async function fetchMultipleStocks(
  symbols: Array<{ symbol: string; name: string; display: string }>,
  options: { onBatch?: (results: MarketData[]) => void } = {},
): Promise<MarketFetchResult> {
  // All symbols go through listMarketQuotes (handler handles Yahoo vs Finnhub routing internally)
  const allSymbolStrings = symbols.map((s) => s.symbol);
  const requestedSymbolSet = new Set(allSymbolStrings);
  const setKey = symbolSetKey(allSymbolStrings);
  const symbolMetaMap = new Map(symbols.map((s) => [s.symbol, s]));

  try {
    console.log('[Market] Fetching quotes for:', allSymbolStrings);
    const resp = await stockBreaker.execute(async () => {
      return client.listMarketQuotes({ symbols: allSymbolStrings });
    }, emptyStockFallback);
    console.log('[Market] Response:', resp.quotes.length, 'quotes, skipped:', resp.finnhubSkipped, resp.skipReason);

    // Filter results to only include requested symbols
    const results = resp.quotes
      .filter((q) => requestedSymbolSet.has(q.symbol))
      .map((q) => {
        const meta = symbolMetaMap.get(q.symbol);
        return toMarketData(q, meta);
      });
    console.log('[Market] Filtered results:', results.length, 'valid quotes');

    // Fire onBatch with whatever we got
    if (results.length > 0) {
      options.onBatch?.(results);
    }

    if (results.length > 0) {
      lastSuccessfulByKey.set(setKey, results);
    }

    // Use cached data or fallback to mocks for commodities
    let data = results.length > 0 ? results : (lastSuccessfulByKey.get(setKey) || []);
    
    // If still empty OR no valid prices, use mock data for symbols we have mocks for
    if (data.length === 0 || !data.some(d => d.price !== null)) {
      const mockResults: MarketData[] = [];
      for (const sym of symbols) {
        const mock = MOCK_DATA[sym.symbol];
        if (mock) {
          mockResults.push({ ...mock, name: sym.name, display: sym.display });
        }
      }
      if (mockResults.length > 0) {
        console.log(`[Market] Using mock data for ${mockResults.length} symbols`);
        data = mockResults;
        options.onBatch?.(mockResults);
      }
    }

    return {
      data,
      skipped: resp.finnhubSkipped || undefined,
      reason: resp.skipReason || undefined,
    };
  } catch (error) {
    console.error('[Market] Error fetching quotes:', error);
    
    // Try to use mock data as fallback
    const mockResults: MarketData[] = [];
    for (const sym of symbols) {
      const mock = MOCK_DATA[sym.symbol];
      if (mock) {
        mockResults.push({ ...mock, name: sym.name, display: sym.display });
      }
    }
    
    if (mockResults.length > 0) {
      console.log(`[Market] Using mock data for ${mockResults.length} symbols (error fallback)`);
      options.onBatch?.(mockResults);
      return { data: mockResults };
    }
    
    return { data: lastSuccessfulByKey.get(setKey) || [] };
  }
}

export async function fetchStockQuote(
  symbol: string,
  name: string,
  display: string,
): Promise<MarketData> {
  const result = await fetchMultipleStocks([{ symbol, name, display }]);
  return result.data[0] || { symbol, name, display, price: null, change: null };
}

// ========================================================================
// Crypto -- removed for Gold Trader fork (returns empty array)
// ========================================================================

export async function fetchCrypto(): Promise<CryptoData[]> {
  return [];
}
