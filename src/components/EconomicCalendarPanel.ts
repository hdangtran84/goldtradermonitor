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
 * 
 * Features 24/7 background updates using Web Worker-based timers to avoid
 * browser throttling when tab is inactive.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { backgroundTimer, keepAlive } from '@/utils';

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
  private refreshIntervalId: number | null = null; // Background timer ID
  private visibilityUnsubscribe: (() => void) | null = null;
  private loading = true;
  private error: string | null = null;
  private weekStart: Date = new Date(); // Monday 00:00 UTC
  private weekEnd: Date = new Date();   // Friday 23:59 UTC

  constructor() {
    super({
      id: 'economic-calendar',
      title: 'Economic Calendar',
      showCount: true,
      infoTooltip: '<strong>Economic Calendar</strong><br>High-impact USD events affecting Gold (current week only):<br>• <strong>PCE/CPI/PPI</strong>: Inflation data<br>• <strong>NFP</strong>: Jobs report (1st Friday)<br>• <strong>FOMC</strong>: Fed rate decisions<br>• <strong>ISM PMI</strong>: Manufacturing/Services<br><em>Data from FXStreet • All times in UTC</em>',
    });
    this.updateWeekBoundaries();
  }

  /** Calculate current week boundaries (Monday 00:00 UTC to Friday 23:59 UTC) */
  private updateWeekBoundaries(): void {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    
    // Calculate Monday of current week
    // If today is Sunday (0), go back 6 days; if Monday (1), go back 0 days, etc.
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    this.weekStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysToMonday,
      0, 0, 0, 0
    ));
    
    // Friday is 4 days after Monday
    this.weekEnd = new Date(Date.UTC(
      this.weekStart.getUTCFullYear(),
      this.weekStart.getUTCMonth(),
      this.weekStart.getUTCDate() + 4,
      23, 59, 59, 999
    ));
  }

  /** Check if a date falls within the current week (Mon-Fri UTC) */
  private isInCurrentWeek(date: Date): boolean {
    return date >= this.weekStart && date <= this.weekEnd;
  }

  async init(): Promise<void> {
    this.renderContent();
    await this.fetchEvents();
    this.startAutoRefresh();
  }

  /**
   * Start auto-refresh using Web Worker-based timer for 24/7 operation
   * This timer is not throttled when the browser tab is in background
   */
  private startAutoRefresh(): void {
    if (this.refreshIntervalId !== null) {
      backgroundTimer.clearInterval(this.refreshIntervalId);
    }
    
    // Use background timer (Web Worker-based) to avoid browser throttling
    this.refreshIntervalId = backgroundTimer.setInterval(() => {
      // Update week boundaries in case week changed
      this.updateWeekBoundaries();
      this.fetchEvents();
    }, REFRESH_INTERVAL_MS);

    // Subscribe to visibility changes to catch up on missed updates
    this.visibilityUnsubscribe = keepAlive.onVisibilityChange((isVisible) => {
      if (isVisible) {
        const hiddenDuration = keepAlive.getHiddenDuration();
        if (hiddenDuration > REFRESH_INTERVAL_MS) {
          console.log('[EconomicCalendarPanel] Tab visible after being hidden, refreshing data');
          this.updateWeekBoundaries();
          this.fetchEvents();
        }
      }
    });
  }

  private async fetchEvents(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.updateWeekBoundaries(); // Ensure week boundaries are current
    this.renderContent();

    try {
      // Try Finnhub economic calendar (more reliable) then FXStreet as fallback
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      // Primary: Finnhub API (reliable for economic data)
      let response = await fetch('/api/economic-calendar', { signal: controller.signal });
      let data: Record<string, unknown> | unknown[] = {};
      let useFinnhub = false;
      
      if (response.ok) {
        data = await response.json();
        // Check if response body contains an error (Finnhub returns 200 with error in body)
        useFinnhub = !('error' in data) && (Array.isArray(data) || Array.isArray((data as Record<string, unknown>).events));
      }
      
      // Fallback: FXStreet if Finnhub fails or returns error
      if (!useFinnhub) {
        console.warn('[EconomicCalendarPanel] Finnhub unavailable, using FXStreet...');
        response = await fetch('/api/forex-factory-calendar', { signal: controller.signal });
        if (response.ok) {
          data = await response.json();
        }
      }
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log('[EconomicCalendarPanel] API response:', useFinnhub ? 'Finnhub' : 'FXStreet', Array.isArray(data) ? data.length : (data as Record<string, unknown>).events);
      
      // Handle both response formats:
      // - Finnhub API: { events: [...] } with time, event, estimate, actual, prev
      // - FXStreet/Vercel API: { events: [...] } or array
      const rawEvents = (Array.isArray(data) ? data : ((data as Record<string, unknown>).events || [])) as Array<{
        id?: string;
        eventId?: string;
        name?: string;
        event?: string;
        dateUtc?: string;
        time?: string;
        countryCode?: string;
        country?: string;
        currencyCode?: string;
        currency?: string;
        volatility?: string;
        impact?: 'high' | 'medium' | 'low' | number;
        actual?: number | string | null;
        estimate?: number | string | null;
        consensus?: number | string | null;
        previous?: number | string | null;
        prev?: number | string | null;
        forecast?: string;
        unit?: string;
        goldEffect?: { direction: string };
      }>;
      
      // Check for API error response
      if ('error' in data || 'fallback' in data) {
        console.warn('[EconomicCalendarPanel] API error:', (data as Record<string, unknown>).error);
        this.events = this.getMockEvents();
      } else if (rawEvents.length === 0) {
        console.warn('[EconomicCalendarPanel] API returned no events, using mock data');
        this.events = this.getMockEvents();
      } else {
        // Events - transform to our format (handle both Finnhub and FXStreet formats)
        this.events = rawEvents
          .map((e) => {
            // Map Finnhub impact (1-3) to our format
            let impactLevel: 'high' | 'medium' | 'low' = 'low';
            if (typeof e.impact === 'number') {
              impactLevel = e.impact >= 3 ? 'high' : e.impact >= 2 ? 'medium' : 'low';
            } else if (typeof e.impact === 'string') {
              impactLevel = e.impact as 'high' | 'medium' | 'low';
            } else if (e.volatility) {
              impactLevel = this.mapVolatility(e.volatility);
            }
            
            return {
              id: e.id || `eco-${e.eventId || e.event}-${e.dateUtc || e.time}`,
              name: e.name || e.event || 'Unknown Event',
              time: new Date(e.dateUtc || e.time || Date.now()),
              country: e.countryCode || e.country || 'US',
              currency: e.currencyCode || e.currency || 'USD',
              impact: impactLevel,
              actual: e.actual != null ? String(e.actual) + (e.unit || '') : undefined,
              forecast: e.estimate != null ? String(e.estimate) + (e.unit || '') : 
                        e.consensus != null ? String(e.consensus) + (e.unit || '') : e.forecast,
              previous: e.prev != null ? String(e.prev) + (e.unit || '') :
                        e.previous != null ? String(e.previous) + (e.unit || '') : undefined,
              goldEffect: e.goldEffect?.direction || this.getGoldEffect(e.name || e.event || ''),
            };
          })
          // Filter: only USD high-impact events in current week (Mon-Fri UTC)
          .filter((e: EconomicEvent) => 
            e.currency === 'USD' && e.impact === 'high' && this.isInCurrentWeek(e.time)
          )
          // Sort by time (chronological)
          .sort((a: EconomicEvent, b: EconomicEvent) => {
            return a.time.getTime() - b.time.getTime();
          });
        
        if (this.events.length === 0) {
          console.warn('[EconomicCalendarPanel] No high-impact USD events in current week, using mock data');
          this.events = this.getMockEvents();
        } else {
          console.log(`[EconomicCalendarPanel] Loaded ${this.events.length} high-impact USD events for week of ${this.formatWeekRange()}`);
        }
      }
    } catch (err) {
      console.warn('[EconomicCalendarPanel] API fetch failed, using mock data:', err);
      this.events = this.getMockEvents();
    }

    this.loading = false;
    this.setCount(this.events.length);
    this.renderContent();
  }

  /** Format week range as "Mar 03 - Mar 07" */
  private formatWeekRange(): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startMonth = months[this.weekStart.getUTCMonth()];
    const startDay = this.weekStart.getUTCDate().toString().padStart(2, '0');
    const endMonth = months[this.weekEnd.getUTCMonth()];
    const endDay = this.weekEnd.getUTCDate().toString().padStart(2, '0');
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
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
    // Generate mock events for current week only (Mon-Fri UTC)
    // These reflect typical high-impact USD events that occur each week
    // Matches Investing.com calendar format - updated for accuracy
    
    const now = new Date();
    
    // Helper to create date at specific UTC time on a specific weekday this week
    // weekdayOffset: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
    const atWeekdayUTC = (weekdayOffset: number, hour: number, minute: number = 0): Date => {
      const d = new Date(this.weekStart);
      d.setUTCDate(d.getUTCDate() + weekdayOffset);
      d.setUTCHours(hour, minute, 0, 0);
      return d;
    };
    
    // Define typical high-impact USD events matching Investing.com calendar
    // All times in UTC (US releases at 8:30 AM ET = 13:30 UTC, 10:00 AM ET = 15:00 UTC)
    // Note: Use API data when available - this is fallback only
    const mockEvents: EconomicEvent[] = [
      // Monday - ISM Manufacturing PMI (first business day)
      {
        id: 'ism-manufacturing',
        name: 'US ISM Manufacturing PMI',
        time: atWeekdayUTC(0, 15, 0), // Monday 15:00 UTC (10:00 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '49.5',
        previous: '50.9',
        goldEffect: 'Below 50 = contraction → Safe haven Gold bid',
      },
      // Tuesday - JOLTS Job Openings (labor market)
      {
        id: 'jolts',
        name: 'US JOLTS Job Openings',
        time: atWeekdayUTC(1, 15, 0), // Tuesday 15:00 UTC (10:00 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '7.60M',
        previous: '7.74M',
        goldEffect: 'Weak job openings → Labor softening → Gold up',
      },
      // Wednesday - ADP Nonfarm Employment Change
      {
        id: 'adp-employment',
        name: 'US ADP Nonfarm Employment Change',
        time: atWeekdayUTC(2, 13, 15), // Wednesday 13:15 UTC (8:15 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '150K',
        previous: '183K',
        goldEffect: 'ADP preview for NFP → Weak = Gold supportive',
      },
      // Wednesday - ISM Services PMI
      {
        id: 'ism-services',
        name: 'US ISM Services PMI',
        time: atWeekdayUTC(2, 15, 0), // Wednesday 15:00 UTC (10:00 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '52.5',
        previous: '52.8',
        goldEffect: 'Services sector health affects rate expectations',
      },
      // Thursday - Initial Jobless Claims (weekly)
      {
        id: 'jobless',
        name: 'US Initial Jobless Claims',
        time: atWeekdayUTC(3, 13, 30), // Thursday 13:30 UTC (8:30 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '216K',
        previous: '213K',
        goldEffect: 'Higher claims → Weak labor → Gold supportive',
      },
      // Friday - NFP (first Friday of month) or other high-impact data
      {
        id: 'ppi-mom',
        name: 'US PPI (MoM)',
        time: atWeekdayUTC(4, 13, 30), // Friday 13:30 UTC (8:30 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.3%',
        previous: '0.4%',
        goldEffect: 'Producer Price Index signals future consumer inflation',
      },
      // Friday - Core PPI
      {
        id: 'core-ppi-mom',
        name: 'US Core PPI (MoM)',
        time: atWeekdayUTC(4, 13, 30), // Friday 13:30 UTC (8:30 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '0.2%',
        previous: '0.3%',
        goldEffect: 'Core PPI excludes food/energy volatility',
      },
      // Friday - Michigan Consumer Sentiment (preliminary)
      {
        id: 'michigan-sentiment',
        name: 'US Michigan Consumer Sentiment',
        time: atWeekdayUTC(4, 15, 0), // Friday 15:00 UTC (10:00 ET)
        country: 'US',
        currency: 'USD',
        impact: 'high',
        forecast: '64.0',
        previous: '64.7',
        goldEffect: 'Consumer confidence affects spending outlook',
      },
    ];

    // Mark events as "released" if their time has passed, add actual values
    return mockEvents
      .filter(e => this.isInCurrentWeek(e.time)) // Only current week events
      .map(e => ({
        ...e,
        actual: e.time < now ? (e.forecast || '—') : undefined, // Mock actual = forecast for past events
      }))
      .sort((a, b) => a.time.getTime() - b.time.getTime()); // Chronological order
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
          <span>No high-impact events this week (${this.formatWeekRange()})</span>
        </div>
      `);
      return;
    }

    const now = new Date();
    const eventCards = this.events.map(event => this.renderEventCard(event, now)).join('');

    this.setContent(`
      <div class="economic-calendar-header">
        <span class="week-range">Week: ${this.formatWeekRange()}</span>
      </div>
      <div class="economic-calendar-list">
        ${eventCards}
      </div>
      <div class="economic-calendar-footer">
        <span class="calendar-legend">
          <span class="impact-dot high"></span> High Impact
        </span>
        <span class="last-updated">Updated: ${this.formatTimeUTC(now)}</span>
      </div>
    `);

    // Attach retry handler
    this.element.addEventListener('retry', () => this.fetchEvents(), { once: true });
  }

  private renderEventCard(event: EconomicEvent, now: Date): string {
    const isPast = event.time < now;

    // Always show full UTC date/time format: "Mon, Mar 03 13:30 UTC"
    const timeDisplay = isPast 
      ? `${this.formatDateTimeUTC(event.time)} ✓`
      : this.formatDateTimeUTC(event.time);

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

  destroy(): void {
    if (this.refreshIntervalId !== null) {
      backgroundTimer.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    if (this.visibilityUnsubscribe) {
      this.visibilityUnsubscribe();
      this.visibilityUnsubscribe = null;
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
