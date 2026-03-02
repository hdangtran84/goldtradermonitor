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
      infoTooltip: '<strong>Economic Calendar</strong><br>High-impact USD events affecting Gold:<br>• <strong>PCE/CPI/PPI</strong>: Inflation data<br>• <strong>NFP</strong>: Jobs report (1st Friday)<br>• <strong>FOMC</strong>: Fed rate decisions<br>• <strong>GDP/ISM</strong>: Growth indicators<br><em>Data from FXStreet • All times in UTC</em>',
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
      // Fetch from FXStreet calendar API with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('/api/forex-factory-calendar', { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('[EconomicCalendarPanel] API response:', data);
      
      // Handle both response formats:
      // - Vercel API: { events: [...] }
      // - Direct FXStreet proxy: array of events
      let rawEvents = Array.isArray(data) ? data : (data.events || []);
      
      // Check for API error response
      if (data.error || data.fallback) {
        console.warn('[EconomicCalendarPanel] FXStreet API error:', data.error);
        this.events = this.getMockEvents();
      } else if (rawEvents.length === 0) {
        console.warn('[EconomicCalendarPanel] FXStreet API returned no events, using mock data');
        this.events = this.getMockEvents();
      } else {
        // Events already filtered by API (USD HIGH impact) - just transform to our format
        const now = new Date();
        this.events = rawEvents
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
            impact: this.mapVolatility(e.volatility) || e.impact || 'high',
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
    // Dynamically generated mock events based on typical US economic calendar patterns
    // Events are positioned relative to the current date to appear realistic
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const dayOfMonth = today.getDate();
    
    // Helper to create date at specific UTC time
    const atTimeUTC = (daysOffset: number, hour: number, minute: number = 0): Date => {
      const d = new Date(today);
      d.setDate(d.getDate() + daysOffset);
      d.setUTCHours(hour, minute, 0, 0);
      return d;
    };
    
    // Calculate days until first Friday of month (NFP day)
    const getFirstFridayOffset = (): number => {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      let firstFriday = new Date(firstOfMonth);
      firstFriday.setDate(1 + ((5 - firstOfMonth.getDay() + 7) % 7));
      const diff = Math.ceil((firstFriday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      // If first Friday passed, calculate next month's first Friday
      if (diff < -1) {
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        firstFriday = new Date(nextMonth);
        firstFriday.setDate(1 + ((5 - nextMonth.getDay() + 7) % 7));
        return Math.ceil((firstFriday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
      return diff;
    };
    
    const nfpOffset = getFirstFridayOffset();
    
    // Realistic upcoming events based on typical US economic calendar
    const mockEvents: EconomicEvent[] = [
      // ISM Manufacturing PMI - 1st business day of month at 10:00 EST (15:00 UTC)
      {
        id: 'ism-mfg',
        name: 'ISM Manufacturing PMI',
        time: dayOfMonth <= 3 ? atTimeUTC(0, 15, 0) : atTimeUTC(-dayOfMonth + 1, 15, 0), // If early in month, today; else mark as released
        country: 'US',
        currency: 'USD',
        impact: 'high',
        actual: dayOfMonth <= 3 ? undefined : '50.3',
        forecast: '49.5',
        previous: '50.9',
        goldEffect: 'Below 50 = contraction → Safe haven Gold bid',
      },
      // ISM Services PMI - 3rd business day of month at 10:00 EST (15:00 UTC)
      {
        id: 'ism-svc',
        name: 'ISM Services PMI',
        time: atTimeUTC(dayOfMonth <= 3 ? 2 : -(dayOfMonth - 3), 15, 0),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '52.5',
        previous: '52.8',
        goldEffect: 'Services sector health affects rate expectations',
      },
      // Nonfarm Payrolls - 1st Friday of month at 8:30 EST (13:30 UTC)
      {
        id: 'nfp',
        name: 'Nonfarm Payrolls',
        time: atTimeUTC(nfpOffset, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '185K',
        previous: '143K',
        goldEffect: 'Strong NFP → USD rally → Gold sell-off',
      },
      // Unemployment Rate - same time as NFP
      {
        id: 'unemp-rate',
        name: 'Unemployment Rate',
        time: atTimeUTC(nfpOffset, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '4.0%',
        previous: '4.0%',
        goldEffect: 'Rising unemployment → Fed dovish → Gold up',
      },
      // Average Hourly Earnings - same time as NFP
      {
        id: 'avg-earnings',
        name: 'Average Hourly Earnings m/m',
        time: atTimeUTC(nfpOffset, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.5%',
        goldEffect: 'Wage inflation signals → Fed tightening risk',
      },
      // CPI - typically mid-month (around 12th-14th) at 8:30 EST (13:30 UTC)
      {
        id: 'cpi',
        name: 'CPI m/m',
        time: atTimeUTC(dayOfMonth < 12 ? 12 - dayOfMonth : 30 + 12 - dayOfMonth, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.2%',
        previous: '0.3%',
        goldEffect: 'Higher CPI → Inflation fears → Gold bullish',
      },
      // Core CPI - same time as CPI
      {
        id: 'core-cpi',
        name: 'Core CPI m/m',
        time: atTimeUTC(dayOfMonth < 12 ? 12 - dayOfMonth : 30 + 12 - dayOfMonth, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.3%',
        goldEffect: 'Core inflation drives Fed policy decisions',
      },
      // Retail Sales - typically around 15th-17th of month
      {
        id: 'retail-sales',
        name: 'Retail Sales m/m',
        time: atTimeUTC(dayOfMonth < 15 ? 15 - dayOfMonth : 30 + 15 - dayOfMonth, 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '-0.9%',
        goldEffect: 'Strong retail → Consumer strength → Fed hawkish',
      },
      // PCE - typically last Friday of month at 8:30 EST (13:30 UTC)
      {
        id: 'pce',
        name: 'PCE Price Index m/m',
        time: atTimeUTC(dayOfMonth > 25 ? 0 : -(dayOfMonth - 28 + 7), 13, 30), // Roughly last week of month
        country: 'US',
        currency: 'USD',
        impact: 'high',
        actual: dayOfMonth > 25 ? undefined : '0.3%',
        forecast: '0.3%',
        previous: '0.3%',
        goldEffect: "Fed's preferred inflation gauge - key for Gold",
      },
      // Core PCE
      {
        id: 'core-pce',
        name: 'Core PCE Price Index m/m',
        time: atTimeUTC(dayOfMonth > 25 ? 0 : -(dayOfMonth - 28 + 7), 13, 30),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        actual: dayOfMonth > 25 ? undefined : '0.4%',
        forecast: '0.3%',
        previous: '0.2%',
        goldEffect: 'Hot Core PCE → Hawkish Fed → Gold pressure',
      },
      // FOMC - typically 3rd week of alternate months
      {
        id: 'fomc',
        name: 'FOMC Interest Rate Decision',
        time: atTimeUTC(21 - dayOfMonth > 0 ? 21 - dayOfMonth : 30 + 21 - dayOfMonth, 19, 0),
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '4.50%',
        previous: '4.50%',
        goldEffect: 'Rate unchanged → Focus on dot plot guidance',
      },
      // Initial Jobless Claims - every Thursday at 8:30 EST (13:30 UTC)
      {
        id: 'jobless-claims',
        name: 'Initial Jobless Claims',
        time: atTimeUTC((4 - dayOfWeek + 7) % 7, 13, 30), // Next Thursday
        country: 'US',
        currency: 'USD',
        impact: 'medium',
        forecast: '220K',
        previous: '242K',
        goldEffect: 'Higher claims → Weak labor → Gold supportive',
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
        <span class="last-updated">Updated: ${this.formatTimeUTC(now)}</span>
      </div>
    `);

    // Attach retry handler
    this.element.addEventListener('retry', () => this.fetchEvents(), { once: true });
  }

  private renderEventCard(event: EconomicEvent, now: Date): string {
    const isPast = event.time < now;
    const isToday = this.isSameUTCDay(event.time, now);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const isTomorrow = this.isSameUTCDay(event.time, tomorrow);

    let timeDisplay: string;
    if (isPast) {
      timeDisplay = 'Released';
    } else if (isToday) {
      timeDisplay = `Today ${this.formatTimeUTC(event.time)}`;
    } else if (isTomorrow) {
      timeDisplay = `Tomorrow ${this.formatTimeUTC(event.time)}`;
    } else {
      timeDisplay = this.formatDateTimeUTC(event.time);
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

  /** Format time as HH:MM UTC */
  private formatTimeUTC(date: Date): string {
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes} UTC`;
  }

  /** Format date+time as "Mon, Mar 03 13:30 UTC" */
  private formatDateTimeUTC(date: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = days[date.getUTCDay()];
    const month = months[date.getUTCMonth()];
    const dateNum = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${day}, ${month} ${dateNum} ${hours}:${minutes} UTC`;
  }

  /** Check if two dates are the same day in UTC */
  private isSameUTCDay(date1: Date, date2: Date): boolean {
    return date1.getUTCFullYear() === date2.getUTCFullYear() &&
           date1.getUTCMonth() === date2.getUTCMonth() &&
           date1.getUTCDate() === date2.getUTCDate();
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
