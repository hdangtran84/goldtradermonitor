/**
 * GoldBrief - AI-powered Gold Market Brief component
 * Displays a horizontal scrolling ticker at the top of the dashboard
 * Refreshes every 5-10 minutes via Groq Llama API
 */
import { proxyUrl } from '@/utils/proxy';

export interface GoldBriefState {
  brief: string | null;
  sentiment: 'bullish' | 'bearish' | 'neutral' | null;
  timestamp: Date | null;
  loading: boolean;
  error: string | null;
  model: string | null;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = 'gold-brief-cache';

export class GoldBrief {
  private container: HTMLElement;
  private state: GoldBriefState;
  private refreshBtn: HTMLButtonElement | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.state = {
      brief: null,
      sentiment: null,
      timestamp: null,
      loading: false,
      error: null,
      model: null,
    };
  }

  async init(): Promise<void> {
    this.loadFromCache();
    this.render();
    await this.fetchBrief();
    this.startAutoRefresh();
  }

  private loadFromCache(): void {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        // Only use cache if less than 10 minutes old
        if (data.timestamp && Date.now() - new Date(data.timestamp).getTime() < 10 * 60 * 1000) {
          this.state.brief = data.brief;
          this.state.sentiment = data.sentiment;
          this.state.timestamp = new Date(data.timestamp);
          this.state.model = data.model;
        }
      }
    } catch (e) {
      console.warn('[GoldBrief] Cache load error:', e);
    }
  }

  private saveToCache(): void {
    try {
      const data = {
        brief: this.state.brief,
        sentiment: this.state.sentiment,
        timestamp: this.state.timestamp?.toISOString(),
        model: this.state.model,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[GoldBrief] Cache save error:', e);
    }
  }

  private render(): void {
    const tickerText = this.getTickerText();
    
    this.container.innerHTML = `
      <div class="gold-brief-ticker">
        <div class="ticker-label">
          <span class="ticker-icon">🤖</span>
          <span class="ticker-title">AI BRIEF</span>
        </div>
        <div class="ticker-content">
          <div class="ticker-track">
            <span class="ticker-text">${tickerText}</span>
            <span class="ticker-text ticker-text-duplicate">${tickerText}</span>
          </div>
        </div>
        <div class="ticker-controls">
          <button class="ticker-refresh-btn" title="Refresh AI Brief">⟳</button>
        </div>
      </div>
    `;

    this.refreshBtn = this.container.querySelector('.ticker-refresh-btn');

    // Bind events
    this.refreshBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fetchBrief();
    });
  }

  private getTickerText(): string {
    if (this.state.loading) {
      return 'Generating AI market brief...';
    }
    
    if (this.state.error) {
      return `⚠️ ${this.state.error} - Click refresh to retry`;
    }
    
    if (!this.state.brief) {
      return 'Loading gold market analysis...';
    }

    // Format the brief as a single-line ticker text
    const sentiment = this.state.sentiment?.toUpperCase() || 'NEUTRAL';
    const sentimentEmoji = this.state.sentiment === 'bullish' ? '📈' : this.state.sentiment === 'bearish' ? '📉' : '➖';
    
    // Clean up the brief text - remove markdown, newlines, and format for ticker
    const cleanBrief = this.state.brief
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/[•\-]\s*/g, ' | ')
      .replace(/\n+/g, ' | ')
      .replace(/\s+/g, ' ')
      .trim();

    return `${sentimentEmoji} OUTLOOK: ${sentiment} | ${cleanBrief}`;
  }

  async fetchBrief(): Promise<void> {
    if (this.state.loading) return;

    this.state.loading = true;
    this.state.error = null;
    this.updateDisplay();

    try {
      const url = proxyUrl('/api/gold-brief');
      const response = await fetch(url);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.brief) {
        throw new Error('Empty response from AI');
      }

      this.state.brief = data.brief;
      this.state.sentiment = data.sentiment || 'neutral';
      this.state.timestamp = new Date(data.timestamp || Date.now());
      this.state.model = data.model || 'AI';
      this.state.loading = false;
      this.state.error = null;

      this.saveToCache();
      this.updateDisplay();
    } catch (err) {
      console.error('[GoldBrief] Fetch error:', err);
      this.state.loading = false;
      this.state.error = err instanceof Error ? err.message : 'Failed to fetch brief';
      this.updateDisplay();
    }
  }

  private updateDisplay(): void {
    const tickerText = this.getTickerText();
    const tickerTexts = this.container.querySelectorAll('.ticker-text');
    tickerTexts.forEach(el => {
      el.textContent = tickerText;
    });

    // Update loading state on button
    if (this.refreshBtn) {
      this.refreshBtn.disabled = this.state.loading;
      this.refreshBtn.classList.toggle('loading', this.state.loading);
    }

    // Update sentiment class on ticker
    const ticker = this.container.querySelector('.gold-brief-ticker');
    if (ticker) {
      ticker.classList.remove('sentiment-bullish', 'sentiment-bearish', 'sentiment-neutral');
      if (this.state.sentiment) {
        ticker.classList.add(`sentiment-${this.state.sentiment}`);
      }
    }
  }

  private startAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(() => {
      this.fetchBrief();
    }, REFRESH_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container.innerHTML = '';
  }
}
