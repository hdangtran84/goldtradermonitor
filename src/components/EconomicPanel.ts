import { Panel } from './Panel';
import type { FredSeries } from '@/services/economic';
import { t } from '@/services/i18n';
import type { SpendingSummary } from '@/services/usa-spending';
import { getChangeClass, formatChange } from '@/services/economic';
import { formatAwardAmount, getAwardTypeIcon } from '@/services/usa-spending';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';

type TabId = 'indicators' | 'spending' | 'centralBanks';

// FRED series IDs that belong to the Central Banks tab
const CENTRAL_BANK_SERIES = ['WALCL', 'FEDFUNDS'];

export class EconomicPanel extends Panel {
  private fredData: FredSeries[] = [];
  private spendingData: SpendingSummary | null = null;
  private lastUpdate: Date | null = null;
  private activeTab: TabId = 'indicators';

  constructor() {
    super({ id: 'economic', title: t('panels.economic') });
    
    // Use event delegation for tab clicks (setContent is debounced, so we can't attach after render)
    this.content.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.economic-tab') as HTMLElement | null;
      if (button) {
        const tabId = button.dataset.tab as TabId;
        if (tabId && tabId !== this.activeTab) {
          this.activeTab = tabId;
          this.render();
        }
      }
    });
  }

  public update(data: FredSeries[]): void {
    this.fredData = data;
    this.lastUpdate = new Date();
    this.render();
  }

  // Stub method for backward compatibility - Oil tab removed
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public updateOil(_data: unknown): void {
    // Oil tab removed - no-op
  }

  public updateSpending(data: SpendingSummary): void {
    this.spendingData = data;
    this.render();
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.showLoading();
    }
  }

  private render(): void {
    // Build tabs HTML - 3 tabs: Indicators, Gov, Central Banks
    const tabsHtml = `
      <div class="economic-tabs">
        <button class="economic-tab ${this.activeTab === 'indicators' ? 'active' : ''}" data-tab="indicators">
          📊 ${t('components.economic.indicators')}
        </button>
        <button class="economic-tab ${this.activeTab === 'spending' ? 'active' : ''}" data-tab="spending">
          🏛️ ${t('components.economic.gov')}
        </button>
        <button class="economic-tab ${this.activeTab === 'centralBanks' ? 'active' : ''}" data-tab="centralBanks">
          🏦 ${t('components.economic.centralBanks')}
        </button>
      </div>
    `;

    let contentHtml = '';

    switch (this.activeTab) {
      case 'indicators':
        contentHtml = this.renderIndicators();
        break;
      case 'spending':
        contentHtml = this.renderSpending();
        break;
      case 'centralBanks':
        contentHtml = this.renderCentralBanks();
        break;
    }

    const updateTime = this.lastUpdate
      ? this.lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    this.setContent(`
      ${tabsHtml}
      <div class="economic-content">
        ${contentHtml}
      </div>
      <div class="economic-footer">
        <span class="economic-source">${this.getSourceLabel()} • ${updateTime}</span>
      </div>
    `);
  }

  private getSourceLabel(): string {
    switch (this.activeTab) {
      case 'indicators': return 'FRED';
      case 'spending': return 'USASpending.gov';
      case 'centralBanks': return 'FRED';
    }
  }

  private renderIndicators(): string {
    // Filter out central bank indicators (shown in Central Banks tab)
    const indicatorData = this.fredData.filter(s => !CENTRAL_BANK_SERIES.includes(s.id));

    if (indicatorData.length === 0) {
      if (isDesktopRuntime() && !isFeatureAvailable('economicFred')) {
        return `<div class="economic-empty">${t('components.economic.fredKeyMissing')}</div>`;
      }
      return `<div class="economic-empty">${t('components.economic.noIndicatorData')}</div>`;
    }

    return `
      <div class="economic-indicators economic-grid">
        ${indicatorData.map(series => {
      const changeClass = getChangeClass(series.change);
      const changeStr = formatChange(series.change, series.unit);
      const arrow = series.change !== null
        ? (series.change > 0 ? '▲' : series.change < 0 ? '▼' : '–')
        : '';

      return `
            <div class="economic-indicator economic-card" data-series="${escapeHtml(series.id)}">
              <div class="indicator-header">
                <span class="indicator-name">${escapeHtml(series.name)}</span>
                <span class="indicator-id">${escapeHtml(series.id)}</span>
              </div>
              <div class="indicator-value">
                <span class="value">${escapeHtml(String(series.value !== null ? series.value : 'N/A'))}${escapeHtml(series.unit)}</span>
                <span class="change ${escapeHtml(changeClass)}">${escapeHtml(arrow)} ${escapeHtml(changeStr)}</span>
              </div>
              <div class="indicator-date">${escapeHtml(series.date)}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  private renderSpending(): string {
    if (!this.spendingData || this.spendingData.awards.length === 0) {
      return `<div class="economic-empty">${t('components.economic.noSpending')}</div>`;
    }

    const { awards, totalAmount, periodStart, periodEnd } = this.spendingData;

    return `
      <div class="spending-summary">
        <div class="spending-total">
          ${escapeHtml(formatAwardAmount(totalAmount))} ${t('components.economic.in')} ${escapeHtml(String(awards.length))} ${t('components.economic.awards')}
          <span class="spending-period">${escapeHtml(periodStart)} – ${escapeHtml(periodEnd)}</span>
        </div>
      </div>
      <div class="spending-list">
        ${awards.slice(0, 8).map(award => `
          <div class="spending-award">
            <div class="award-header">
              <span class="award-icon">${escapeHtml(getAwardTypeIcon(award.awardType))}</span>
              <span class="award-amount">${escapeHtml(formatAwardAmount(award.amount))}</span>
            </div>
            <div class="award-recipient">${escapeHtml(award.recipientName)}</div>
            <div class="award-agency">${escapeHtml(award.agency)}</div>
            ${award.description ? `<div class="award-desc">${escapeHtml(award.description.slice(0, 100))}${award.description.length > 100 ? '...' : ''}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderCentralBanks(): string {
    // Filter for central bank indicators only
    const centralBankData = this.fredData.filter(s => CENTRAL_BANK_SERIES.includes(s.id));

    if (centralBankData.length === 0) {
      if (isDesktopRuntime() && !isFeatureAvailable('economicFred')) {
        return `<div class="economic-empty">${t('components.economic.fredKeyMissing')}</div>`;
      }
      return `<div class="economic-empty">${t('components.economic.noCentralBankData')}</div>`;
    }

    return `
      <div class="economic-indicators economic-grid central-bank-metrics">
        ${centralBankData.map(series => {
      const changeClass = getChangeClass(series.change);
      const changeStr = formatChange(series.change, series.unit);
      const arrow = series.change !== null
        ? (series.change > 0 ? '▲' : series.change < 0 ? '▼' : '–')
        : '';

      return `
            <div class="economic-indicator economic-card" data-series="${escapeHtml(series.id)}">
              <div class="indicator-header">
                <span class="indicator-name">${escapeHtml(series.name)}</span>
                <span class="indicator-id">${escapeHtml(series.id)}</span>
              </div>
              <div class="indicator-value">
                <span class="value">${escapeHtml(String(series.value !== null ? series.value : 'N/A'))}${escapeHtml(series.unit)}</span>
                <span class="change ${escapeHtml(changeClass)}">${escapeHtml(arrow)} ${escapeHtml(changeStr)}</span>
              </div>
              <div class="indicator-date">${escapeHtml(series.date)}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }
}
