// Finance/Trading variant - finance.worldmonitor.app
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// Finance-specific exports
export * from '../finance-geo';

// Re-export feeds infrastructure
export {
  SOURCE_TIERS,
  getSourceTier,
  SOURCE_TYPES,
  getSourceType,
  getSourcePropagandaRisk,
  type SourceRiskProfile,
  type SourceType,
} from '../feeds';

// Finance-specific FEEDS configuration
import type { Feed } from '@/types';

const rss = (url: string) => `/api/rss-proxy?url=${encodeURIComponent(url)}`;

export const FEEDS: Record<string, Feed[]> = {
  // Gold & Precious Metals (primary focus) - Using reliable direct RSS feeds
  commodities: [
    // Direct feeds from financial news sites (more reliable than Google News)
    { name: 'CNBC Commodities', url: rss('https://www.cnbc.com/id/15839069/device/rss/rss.html') },
    { name: 'Reuters Commodities', url: rss('https://news.google.com/rss/search?q=gold+OR+silver+OR+commodities+site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Kitco Gold', url: rss('https://news.google.com/rss/search?q=gold+site:kitco.com+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Gold Price', url: rss('https://news.google.com/rss/search?q=%22gold+price%22+OR+XAUUSD+OR+%22gold+trading%22+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Precious Metals', url: rss('https://news.google.com/rss/search?q=silver+OR+platinum+OR+palladium+OR+%22precious+metals%22+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],

  // Markets (gold correlations)
  markets: [
    { name: 'CNBC Markets', url: rss('https://www.cnbc.com/id/100003114/device/rss/rss.html') },
    { name: 'MarketWatch', url: rss('https://feeds.marketwatch.com/marketwatch/topstories/') },
    { name: 'Market News', url: rss('https://news.google.com/rss/search?q=%22stock+market%22+OR+%22market+crash%22+OR+%22market+rally%22+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Safe Haven', url: rss('https://news.google.com/rss/search?q=VIX+OR+%22risk+off%22+OR+%22safe+haven%22+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],

  // Forex & USD (gold is priced in USD)
  forex: [
    { name: 'FX News', url: rss('https://news.google.com/rss/search?q=forex+OR+%22currency+market%22+OR+EURUSD+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Dollar Index', url: rss('https://news.google.com/rss/search?q=%22dollar+index%22+OR+DXY+OR+%22US+dollar%22+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Currency News', url: rss('https://news.google.com/rss/search?q=%22euro+dollar%22+OR+%22yen%22+OR+%22pound%22+currency+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],

  // Central Banks (gold reserves, rates affect gold)
  centralbanks: [
    { name: 'Federal Reserve', url: rss('https://www.federalreserve.gov/feeds/press_all.xml') },
    { name: 'Fed News', url: rss('https://news.google.com/rss/search?q=%22Federal+Reserve%22+OR+%22Fed+rate%22+OR+Powell+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Rate Decisions', url: rss('https://news.google.com/rss/search?q=%22interest+rate%22+OR+%22rate+hike%22+OR+%22rate+cut%22+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Central Banks', url: rss('https://news.google.com/rss/search?q=%22central+bank%22+gold+OR+%22gold+reserves%22+when:3d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'ECB & BOJ', url: rss('https://news.google.com/rss/search?q=ECB+OR+%22Bank+of+Japan%22+OR+%22Bank+of+England%22+policy+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],

  // Economic Data (inflation, yields affect gold)
  economic: [
    { name: 'Inflation', url: rss('https://news.google.com/rss/search?q=CPI+OR+inflation+OR+%22consumer+prices%22+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Treasury Yields', url: rss('https://news.google.com/rss/search?q=%22Treasury+yield%22+OR+%22bond+yield%22+OR+%2210-year%22+when:12h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Jobs Report', url: rss('https://news.google.com/rss/search?q=%22jobs+report%22+OR+%22nonfarm+payrolls%22+OR+unemployment+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'GDP Data', url: rss('https://news.google.com/rss/search?q=GDP+OR+%22economic+growth%22+OR+recession+when:1d&hl=en-US&gl=US&ceid=US:en') },
  ],

  // Geopolitical & Analysis (gold is safe haven)
  analysis: [
    { name: 'Reuters World', url: rss('https://news.google.com/rss/search?q=geopolitical+OR+war+OR+conflict+site:reuters.com+when:6h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Geopolitical', url: rss('https://news.google.com/rss/search?q=Iran+OR+Israel+OR+Russia+OR+Ukraine+OR+China+Taiwan+when:6h&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Gold Analysis', url: rss('https://news.google.com/rss/search?q=%22gold+forecast%22+OR+%22gold+outlook%22+OR+%22gold+analysis%22+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Risk Analysis', url: rss('https://news.google.com/rss/search?q=sanctions+OR+%22trade+war%22+OR+tariffs+when:1d&hl=en-US&gl=US&ceid=US:en') },
    { name: 'Breaking News', url: rss('https://news.google.com/rss/search?q=breaking+attack+OR+missile+OR+explosion+when:3h&hl=en-US&gl=US&ceid=US:en') },
  ],
};

// Panel configuration for gold trading
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Gold Price Chart', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },
  'economic-calendar': { name: 'Economic Calendar', enabled: true, priority: 1 },
  monitors: { name: 'My Monitors', enabled: true, priority: 1 },
  markets: { name: 'Markets', enabled: false, priority: 2 },
  'markets-news': { name: 'Markets News', enabled: false, priority: 2 },
  forex: { name: 'Forex & Currencies', enabled: true, priority: 1 },
  commodities: { name: 'Commodities', enabled: true, priority: 1 },
  'commodities-news': { name: 'Commodities News', enabled: true, priority: 2 },
  centralbanks: { name: 'Central Bank Watch', enabled: true, priority: 1 },
  economic: { name: 'Economic Indicators', enabled: true, priority: 1 },
  'economic-news': { name: 'Economic News', enabled: true, priority: 2 },
  analysis: { name: 'Market Analysis', enabled: true, priority: 2 },
  polymarket: { name: 'Predictions', enabled: true, priority: 2 },
};

// Finance-focused map layers
export const DEFAULT_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: true,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in finance variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance-specific layers
  stockExchanges: true,
  financialCenters: true,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: true,
};

// Mobile defaults for finance variant
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (limited on mobile)
  stockExchanges: true,
  financialCenters: false,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'finance',
  description: 'Finance, markets & trading intelligence dashboard',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
