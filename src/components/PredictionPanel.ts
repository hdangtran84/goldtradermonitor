import { Panel } from './Panel';
import type { PredictionMarket } from '@/services/prediction';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';

export class PredictionPanel extends Panel {
  constructor() {
    super({
      id: 'polymarket',
      title: 'Gold Price Markets',
      infoTooltip: 'Polymarket prediction markets for Gold (XAU/USD) price milestones',
    });
  }

  private formatVolume(volume?: number): string {
    if (!volume) return '';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  }

  public renderPredictions(data: PredictionMarket[]): void {
    if (data.length === 0) {
      this.setContent(`
        <div class="gold-markets-empty">
          <div class="gold-icon">📊</div>
          <div class="empty-title">No Active Gold Markets</div>
          <div class="empty-message">No active Gold price prediction markets on Polymarket at the moment.</div>
          <div class="empty-refresh">Data refreshes every 5 minutes</div>
        </div>
      `);
      return;
    }

    const html = data
      .map((p) => {
        const yesPercent = Math.round(p.yesPrice);
        const noPercent = 100 - yesPercent;
        const volumeStr = this.formatVolume(p.volume);

        const safeUrl = sanitizeUrl(p.url || '');
        const titleHtml = safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="prediction-question prediction-link gold-market-link">${escapeHtml(p.title)}</a>`
          : `<div class="prediction-question gold-market-title">${escapeHtml(p.title)}</div>`;

        // Determine if odds favor Yes or No
        const yesFavored = yesPercent >= 50;
        const oddsClass = yesFavored ? 'odds-yes-favored' : 'odds-no-favored';

        return `
      <div class="prediction-item gold-market-card">
        ${titleHtml}
        <div class="gold-market-stats">
          ${volumeStr ? `<span class="prediction-volume gold-volume"><span class="stat-label">Vol:</span> ${volumeStr}</span>` : ''}
          <span class="gold-odds ${oddsClass}">
            <span class="stat-label">Odds:</span> ${yesPercent}%
          </span>
        </div>
        <div class="prediction-bar gold-prediction-bar">
          <div class="prediction-yes gold-yes" style="width: ${yesPercent}%">
            <span class="prediction-label">${t('components.predictions.yes')} ${yesPercent}%</span>
          </div>
          <div class="prediction-no gold-no" style="width: ${noPercent}%">
            <span class="prediction-label">${t('components.predictions.no')} ${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
      })
      .join('');

    const headerHtml = `
      <div class="gold-markets-header">
        <span class="gold-header-icon">🥇</span>
        <span class="gold-header-text">Gold (XAU/USD) Prediction Markets</span>
        <span class="gold-market-count">${data.length} active</span>
      </div>
    `;

    this.setContent(headerHtml + html);
  }
}
