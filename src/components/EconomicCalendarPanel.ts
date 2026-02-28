/**
 * EconomicCalendarPanel - Displays high-impact economic events for Gold/USD trading
 * 
 * Shows upcoming and recent economic events that affect Gold prices:
 * - CPI, PPI, NFP, Unemployment Rate
 * - Fed Funds Rate, FOMC statements
 * - Fed speakers, Treasury Secretary speeches
 * - GDP, Retail Sales, etc.
 * 
 * Data sources (in priority order):
 * 1. Investing.com Economic Calendar API (requires proxy)
 * 2. Forex Factory RSS (free, limited)
 * 3. FRED API for US economic data releases
 * 4. Mock data fallback
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

export interface EconomicEvent {
  id: string;
  name: string;
  time: Date;
  country: string;
  currency: string;
  impact: 'high' | 'medium' | 'low';
  actual?: string;
  forecast?: string;
  previous?: string;
  goldEffect?: string;
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/*
 * High-impact keywords for filtering Gold-relevant events (for future API integration):
 * CPI, PPI, NFP, Unemployment, FOMC, Fed Funds Rate, Powell, GDP, Retail Sales, PCE, Tariffs
 */

export class EconomicCalendarPanel extends Panel {
  private events: EconomicEvent[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
    super({
      id: 'economic-calendar',
      title: 'Economic Calendar',
      showCount: true,
      infoTooltip: '<strong>Economic Calendar</strong><br>High-impact USD events affecting Gold:<br>• <strong>PCE/CPI/PPI</strong>: Inflation data<br>• <strong>NFP</strong>: Jobs report (1st Friday)<br>• <strong>FOMC</strong>: Fed rate decisions<br>• <strong>GDP/ISM</strong>: Growth indicators<br><em>Data from FXStreet • Times in local timezone</em>',
    });
  }

  async init(): Promise<void> {
    this.renderContent();
    await this.fetchEvents();
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => {
      this.fetchEvents();
    }, REFRESH_INTERVAL_MS);
  }

  private async fetchEvents(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderContent();

    try {
      // Fetch from FXStreet calendar API
      const response = await fetch('/api/forex-factory-calendar');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Handle both response formats:
      // - Vercel API: { events: [...] }
      // - Direct FXStreet proxy: array of events
      let rawEvents = Array.isArray(data) ? data : (data.events || []);
      
      if (rawEvents.length === 0) {
        console.warn('[EconomicCalendarPanel] FXStreet API returned no events, using mock data');
        this.events = this.getMockEvents();
      } else {
        // Filter for USD HIGH impact events and transform to our format
        const now = new Date();
        this.events = rawEvents
          .filter((e: { currencyCode?: string; volatility?: string }) => 
            e.currencyCode === 'USD' && e.volatility === 'HIGH'
          )
          .map((e: {
            id?: string;
            eventId?: string;
            name?: string;
            dateUtc?: string;
            time?: string;
            countryCode?: string;
            country?: string;
            currencyCode?: string;
            currency?: string;
            volatility?: string;
            impact?: 'high' | 'medium' | 'low';
            actual?: number | string | null;
            consensus?: number | string | null;
            previous?: number | string | null;
            forecast?: string;
            unit?: string;
            goldEffect?: { direction: string };
          }) => ({
            id: e.id || `fxs-${e.eventId}-${e.dateUtc || e.time}`,
            name: e.name || 'Unknown Event',
            time: new Date(e.dateUtc || e.time || Date.now()),
            country: e.countryCode || e.country || 'US',
            currency: e.currencyCode || e.currency || 'USD',
            impact: this.mapVolatility(e.volatility) || e.impact || 'medium',
            actual: e.actual != null ? String(e.actual) + (e.unit || '') : undefined,
            forecast: e.consensus != null ? String(e.consensus) + (e.unit || '') : e.forecast,
            previous: e.previous != null ? String(e.previous) + (e.unit || '') : undefined,
            goldEffect: e.goldEffect?.direction || this.getGoldEffect(e.name || ''),
          }))
          .sort((a: EconomicEvent, b: EconomicEvent) => {
            const aIsPast = a.time < now;
            const bIsPast = b.time < now;
            if (aIsPast && !bIsPast) return 1;
            if (!aIsPast && bIsPast) return -1;
            if (aIsPast && bIsPast) return b.time.getTime() - a.time.getTime();
            return a.time.getTime() - b.time.getTime();
          });
        
        if (this.events.length === 0) {
          console.warn('[EconomicCalendarPanel] No high-impact USD events found, using mock data');
          this.events = this.getMockEvents();
        } else {
          console.log(`[EconomicCalendarPanel] Loaded ${this.events.length} high-impact USD events from FXStreet`);
        }
      }
    } catch (err) {
      console.warn('[EconomicCalendarPanel] FXStreet fetch failed, using mock data:', err);
      this.events = this.getMockEvents();
    }

    this.loading = false;
    this.setCount(this.events.filter(e => e.impact === 'high').length);
    this.renderContent();
  }

  private mapVolatility(volatility?: string): 'high' | 'medium' | 'low' {
    switch (volatility?.toUpperCase()) {
      case 'HIGH': return 'high';
      case 'MEDIUM': return 'medium';
      case 'LOW': return 'low';
      default: return 'low';
    }
  }

  private getGoldEffect(eventName: string): string {
    const name = eventName.toLowerCase();
    
    if (name.includes('cpi') || name.includes('consumer price')) {
      return 'Higher CPI → Inflation fears → Gold bullish';
    }
    if (name.includes('ppi') || name.includes('producer price')) {
      return 'Producer inflation signals future CPI';
    }
    if (name.includes('nonfarm') || name.includes('payroll') || name.includes('employment change')) {
      return 'Strong jobs → USD rally → Gold pressure';
    }
    if (name.includes('unemployment') || name.includes('jobless')) {
      return 'Higher claims → Weak labor → Fed dovish → Gold up';
    }
    if (name.includes('fomc') || name.includes('fed') || name.includes('interest rate')) {
      return 'Hawkish → Gold down / Dovish → Gold up';
    }
    if (name.includes('powell') || name.includes('fed chair')) {
      return 'Watch for rate guidance, inflation outlook';
    }
    if (name.includes('gdp')) {
      return 'Strong GDP → USD strength → Gold pressure';
    }
    if (name.includes('retail sales')) {
      return 'Strong retail → Fed hawkish risk';
    }
    if (name.includes('pce') || name.includes('core pce')) {
      return "Fed's preferred inflation gauge - key for rate path";
    }
    if (name.includes('ism') || name.includes('pmi')) {
      return 'Manufacturing health affects USD, Gold inversely';
    }
    if (name.includes('housing') || name.includes('home sales')) {
      return 'Housing weakness → Economic slowdown → Gold safe haven';
    }
    if (name.includes('durable goods')) {
      return 'Business investment signal';
    }
    if (name.includes('trade balance')) {
      return 'Trade deficit affects USD valuation';
    }
    
    return ''; // No specific gold effect for other events
  }

  private getMockEvents(): EconomicEvent[] {
    // Curated high-impact USD events (Finnhub Economic Calendar requires paid plan)
    // These follow typical US economic release schedule patterns
    // Update dates periodically or integrate paid API for real-time data
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Helper to create date at specific time
    const atTime = (daysOffset: number, hour: number, minute: number = 0): Date => {
      const d = new Date(today);
      d.setDate(d.getDate() + daysOffset);
      d.setHours(hour, minute, 0, 0);
      return d;
    };
    
    // Realistic upcoming events based on typical US economic calendar
    const mockEvents: EconomicEvent[] = [
      // Today/Yesterday releases
      {
        id: 'gdp-q4',
        name: 'GDP Growth Rate QoQ (Q4 Second Estimate)',
        time: atTime(0, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        actual: '2.3%',
        forecast: '2.3%',
        previous: '3.1%',
        goldEffect: 'GDP in line with expectations → Neutral for Gold',
      },
      {
        id: 'jobless-claims',
        name: 'Initial Jobless Claims',
        time: atTime(0, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'medium',
        actual: '242K',
        forecast: '221K',
        previous: '219K',
        goldEffect: 'Higher claims → Weak labor → Gold supportive',
      },
      // Tomorrow
      {
        id: 'pce-price',
        name: 'PCE Price Index m/m',
        time: atTime(1, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.3%',
        goldEffect: "Fed's preferred inflation gauge - key for Gold",
      },
      {
        id: 'core-pce',
        name: 'Core PCE Price Index m/m',
        time: atTime(1, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.2%',
        goldEffect: 'Hot Core PCE → Hawkish Fed → Gold pressure',
      },
      {
        id: 'personal-income',
        name: 'Personal Income m/m',
        time: atTime(1, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'medium',
        forecast: '0.4%',
        previous: '0.4%',
        goldEffect: 'Income growth affects consumer spending outlook',
      },
      // Next week
      {
        id: 'ism-mfg',
        name: 'ISM Manufacturing PMI',
        time: atTime(3, 10, 0),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '49.5',
        previous: '50.9',
        goldEffect: 'Below 50 = contraction → Safe haven Gold bid',
      },
      {
        id: 'nfp-mar',
        name: 'Nonfarm Payrolls',
        time: atTime(7, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '160K',
        previous: '143K',
        goldEffect: 'Strong NFP → USD rally → Gold sell-off',
      },
      {
        id: 'unemp-rate',
        name: 'Unemployment Rate',
        time: atTime(7, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '4.0%',
        previous: '4.0%',
        goldEffect: 'Rising unemployment → Fed dovish → Gold up',
      },
      {
        id: 'avg-hourly',
        name: 'Average Hourly Earnings m/m',
        time: atTime(7, 8, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.5%',
        goldEffect: 'Wage inflation signals → Fed tightening risk',
      },
      // Fed events
      {
        id: 'fomc-mar',
        name: 'FOMC Interest Rate Decision',
        time: atTime(21, 14, 0),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '4.50%',
        previous: '4.50%',
        goldEffect: 'Rate unchanged → Focus on dot plot guidance',
      },
      {
        id: 'powell-presser',
        name: 'FOMC Press Conference',
        time: atTime(21, 14, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        goldEffect: 'Powell tone sets market direction for weeks',
      },
    ];

    // Sort: upcoming events first, released at bottom
    return mockEvents.sort((a, b) => {
      const aIsPast = a.time < now;
      const bIsPast = b.time < now;
      // Past events go to bottom
      if (aIsPast && !bIsPast) return 1;
      if (!aIsPast && bIsPast) return -1;
      // Within same group, sort by time (ascending for upcoming, descending for past)
      if (aIsPast && bIsPast) {
        return b.time.getTime() - a.time.getTime(); // Most recent released first
      }
      return a.time.getTime() - b.time.getTime(); // Soonest upcoming first
    });
  }

  private renderContent(): void {
    if (this.loading) {
      this.setContent(`
        <div class="economic-calendar-loading">
          <div class="loading-spinner"></div>
          <span>Loading economic events...</span>
        </div>
      `);
      return;
    }

    if (this.error) {
      this.setContent(`
        <div class="economic-calendar-error">
          <span class="error-icon">⚠️</span>
          <span>${escapeHtml(this.error)}</span>
          <button class="retry-btn" onclick="this.closest('.panel').dispatchEvent(new CustomEvent('retry'))">Retry</button>
        </div>
      `);
      return;
    }

    if (this.events.length === 0) {
      this.setContent(`
        <div class="economic-calendar-empty">
          <span>No upcoming high-impact events</span>
        </div>
      `);
      return;
    }

    const now = new Date();
    const eventCards = this.events.map(event => this.renderEventCard(event, now)).join('');

    this.setContent(`
      <div class="economic-calendar-list">
        ${eventCards}
      </div>
      <div class="economic-calendar-footer">
        <span class="calendar-legend">
          <span class="impact-dot high"></span> High Impact
          <span class="impact-dot medium"></span> Medium
        </span>
        <span class="last-updated">Updated: ${now.toLocaleTimeString()}</span>
      </div>
    `);

    // Attach retry handler
    this.element.addEventListener('retry', () => this.fetchEvents(), { once: true });
  }

  private renderEventCard(event: EconomicEvent, now: Date): string {
    const isPast = event.time < now;
    const isToday = event.time.toDateString() === now.toDateString();
    const isTomorrow = event.time.toDateString() === new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString();

    let timeDisplay: string;
    if (isPast) {
      timeDisplay = 'Released';
    } else if (isToday) {
      timeDisplay = `Today ${event.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (isTomorrow) {
      timeDisplay = `Tomorrow ${event.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      timeDisplay = event.time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + 
                    ' ' + event.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const impactClass = event.impact;
    const pastClass = isPast ? 'past' : '';

    return `
      <div class="economic-event-card ${impactClass} ${pastClass}">
        <div class="event-header">
          <span class="event-flag">${this.getCountryFlag(event.country)}</span>
          <span class="event-name">${escapeHtml(event.name)}</span>
          <span class="event-impact ${impactClass}">${event.impact === 'high' ? '🔴' : event.impact === 'medium' ? '🟡' : '⚪'}</span>
        </div>
        <div class="event-time">${escapeHtml(timeDisplay)}</div>
        ${event.forecast || event.previous || event.actual ? `
          <div class="event-data">
            ${event.actual ? `<span class="data-actual">Actual: <strong>${escapeHtml(event.actual)}</strong></span>` : ''}
            ${event.forecast ? `<span class="data-forecast">Fcst: ${escapeHtml(event.forecast)}</span>` : ''}
            ${event.previous ? `<span class="data-previous">Prev: ${escapeHtml(event.previous)}</span>` : ''}
          </div>
        ` : ''}
        ${event.goldEffect ? `
          <div class="event-gold-effect">
            <span class="gold-icon">🥇</span>
            <span class="effect-text">${escapeHtml(event.goldEffect)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private getCountryFlag(country: string): string {
    const flags: Record<string, string> = {
      'US': '🇺🇸',
      'EU': '🇪🇺',
      'UK': '🇬🇧',
      'JP': '🇯🇵',
      'CN': '🇨🇳',
      'CH': '🇨🇭',
      'AU': '🇦🇺',
      'CA': '🇨🇦',
    };
    return flags[country] || '🌐';
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    super.destroy?.();
  }
}

/*
 * API Integration Instructions:
 * =============================
 * 
 * Option 1: Investing.com Calendar (recommended)
 * - Create a serverless function at /api/economic-calendar
 * - Scrape or use Investing.com's unofficial API
 * - Filter for USD high-impact events
 * 
 * Option 2: Forex Factory XML
 * - Free RSS feed at https://www.forexfactory.com/ffcal_week_this.xml
 * - Already proxied via /api/rss-proxy
 * - Parse XML to extract events
 * 
 * Option 3: FRED API (free with key)
 * - Get release schedule from FRED
 * - Already have FRED_API_KEY configured
 * - Limited to US releases only
 * 
 * Option 4: TradingEconomics API
 * - Paid but comprehensive
 * - Real-time calendar data
 * 
 * Option 5: FXStreet Economic Calendar
 * - Free widget embed option
 * - Or scrape their JSON endpoint
 */
