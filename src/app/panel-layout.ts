import type { AppContext, AppModule } from '@/app/app-context';
import type { RelatedAsset } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import {
  GoldPriceChart,
  GoldBrief,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  PredictionPanel,
  MonitorPanel,
  EconomicPanel,
  LiveNewsPanel,
  TechEventsPanel,
  ServiceStatusPanel,
  RuntimeConfigPanel,
  EconomicCalendarPanel,
  TechReadinessPanel,
  InvestmentsPanel,
  GivingPanel,
} from '@/components';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { saveToStorage } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  FEEDS,
  INTEL_SOURCES,
  DEFAULT_PANELS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { BETA_MODE } from '@/config/beta';
import { t } from '@/services/i18n';
import { getCurrentTheme } from '@/utils';
import { trackCriticalBannerAction } from '@/services/analytics';

export interface PanelLayoutCallbacks {
  openCountryStory: (code: string, name: string) => void;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
}

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutCallbacks;
  private panelDragCleanupHandlers: Array<() => void> = [];
  private criticalBannerEl: HTMLElement | null = null;
  // Note: Time range filter debounce removed - Gold Trader uses chart time range

  constructor(ctx: AppContext, callbacks: PanelLayoutCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  init(): void {
    this.renderLayout();
  }

  destroy(): void {
    this.panelDragCleanupHandlers.forEach((cleanup) => cleanup());
    this.panelDragCleanupHandlers = [];
    if (this.criticalBannerEl) {
      this.criticalBannerEl.remove();
      this.criticalBannerEl = null;
    }
  }

  renderLayout(): void {
    this.ctx.container.innerHTML = `
      <div class="header">
        <div class="header-left">
          <div class="variant-switcher">
            <span class="variant-option active" title="Gold Trader">
              <span class="variant-icon">🥇</span>
              <span class="variant-label">GOLD</span>
            </span>
          </div>
          <span class="logo">Daily Trading Tips</span>${BETA_MODE ? '<span class="beta-badge">BETA</span>' : ''}
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>${t('header.live')}</span>
          </div>
        </div>
        <div class="header-right">
          <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> ${t('header.search')}</button>
          ${this.ctx.isDesktopApp ? '' : `<button class="copy-link-btn" id="copyLinkBtn">${t('header.copyLink')}</button>`}
          <button class="theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
            ${getCurrentTheme() === 'dark'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
          </button>
          ${this.ctx.isDesktopApp ? '' : `<button class="fullscreen-btn" id="fullscreenBtn" title="${t('header.fullscreen')}">⛶</button>`}
          <span id="unifiedSettingsMount"></span>
        </div>
      </div>
      <div class="main-content">
        <div class="top-dashboard-row" id="topDashboardRow">
          <div class="map-section gold-chart-section" id="mapSection">
            <div class="panel-header">
              <div class="panel-header-left">
                <span class="panel-title">Gold Price Chart</span>
              </div>
              <span class="header-clock" id="headerClock"></span>
            </div>
            <div class="map-container gold-chart-mount" id="goldChartContainer"></div>
          </div>
          <div class="livestream-section" id="livestreamSection"></div>
        </div>
        <div class="panels-grid news-grid" id="panelsGrid"></div>
      </div>
    `;

    this.createPanels();
  }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    if (this.ctx.isMobile) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
      }
      document.body.classList.remove('has-critical-banner');
      return;
    }

    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return;
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-posture-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    this.criticalBannerEl.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
        <span class="banner-headline">${escapeHtml(top.headline)}</span>
        <span class="banner-stats">${top.totalAircraft} aircraft • ${escapeHtml(top.summary)}</span>
        ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">×</button>
    `;

    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      trackCriticalBannerAction('view', top.theaterId);
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.ctx.map?.setCenter(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      trackCriticalBannerAction('dismiss', top.theaterId);
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });
  }

  applyPanelSettings(): void {
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      // Finance variant: force monitors visible, markets hidden
      if (SITE_VARIANT === 'finance') {
        if (key === 'monitors') {
          this.ctx.panels[key]?.toggle(true);
          return;
        }
        if (key === 'markets') {
          this.ctx.panels[key]?.toggle(false);
          return;
        }
      }
      const panel = this.ctx.panels[key];
      panel?.toggle(config.enabled);
    });
  }

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;

    // Initialize Gold Price Chart (replaces MapContainer for finance variant)
    const goldChartContainer = document.getElementById('goldChartContainer') as HTMLElement;
    if (goldChartContainer) {
      const goldChart = new GoldPriceChart(goldChartContainer);
      goldChart.init().catch((err) => {
        console.error('[PanelLayout] Failed to initialize GoldPriceChart:', err);
      });
      // Store reference for potential cleanup
      (this.ctx as unknown as { goldChart: GoldPriceChart }).goldChart = goldChart;
    }

    // Initialize AI-powered Gold Brief ticker (horizontal scrolling bar at top)
    const goldBriefContainer = document.createElement('div');
    goldBriefContainer.id = 'goldBriefContainer';
    // Insert at start of main-content so it flows naturally before the dashboard
    const mainContent = document.querySelector('.main-content');
    if (mainContent && mainContent.firstChild) {
      mainContent.insertBefore(goldBriefContainer, mainContent.firstChild);
    } else if (mainContent) {
      mainContent.appendChild(goldBriefContainer);
    } else {
      // Fallback: after header
      const header = document.querySelector('.header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(goldBriefContainer, header.nextSibling);
      } else {
        document.body.insertBefore(goldBriefContainer, document.body.firstChild);
      }
    }
    const goldBrief = new GoldBrief(goldBriefContainer);
    goldBrief.init().catch((err) => {
      console.error('[PanelLayout] Failed to initialize GoldBrief:', err);
    });
    (this.ctx as unknown as { goldBrief: GoldBrief }).goldBrief = goldBrief;

    // Set default time range since we no longer have map
    this.ctx.currentTimeRange = '24h';

    const politicsPanel = new NewsPanel('politics', t('panels.politics'));
    this.attachRelatedAssetHandlers(politicsPanel);
    this.ctx.newsPanels['politics'] = politicsPanel;
    this.ctx.panels['politics'] = politicsPanel;

    const techPanel = new NewsPanel('tech', t('panels.tech'));
    this.attachRelatedAssetHandlers(techPanel);
    this.ctx.newsPanels['tech'] = techPanel;
    this.ctx.panels['tech'] = techPanel;

    const financePanel = new NewsPanel('finance', t('panels.finance'));
    this.attachRelatedAssetHandlers(financePanel);
    this.ctx.newsPanels['finance'] = financePanel;
    this.ctx.panels['finance'] = financePanel;

    const heatmapPanel = new HeatmapPanel();
    this.ctx.panels['heatmap'] = heatmapPanel;

    const marketsPanel = new MarketPanel();
    this.ctx.panels['markets'] = marketsPanel;

    const monitorPanel = new MonitorPanel(this.ctx.monitors);
    this.ctx.panels['monitors'] = monitorPanel;
    monitorPanel.onChanged((monitors) => {
      this.ctx.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      this.callbacks.updateMonitorResults();
    });

    const commoditiesPanel = new CommoditiesPanel();
    this.ctx.panels['commodities'] = commoditiesPanel;

    const predictionPanel = new PredictionPanel();
    this.ctx.panels['polymarket'] = predictionPanel;

    const govPanel = new NewsPanel('gov', t('panels.gov'));
    this.attachRelatedAssetHandlers(govPanel);
    this.ctx.newsPanels['gov'] = govPanel;
    this.ctx.panels['gov'] = govPanel;

    const intelPanel = new NewsPanel('intel', t('panels.intel'));
    this.attachRelatedAssetHandlers(intelPanel);
    this.ctx.newsPanels['intel'] = intelPanel;
    this.ctx.panels['intel'] = intelPanel;

    const middleeastPanel = new NewsPanel('middleeast', t('panels.middleeast'));
    this.attachRelatedAssetHandlers(middleeastPanel);
    this.ctx.newsPanels['middleeast'] = middleeastPanel;
    this.ctx.panels['middleeast'] = middleeastPanel;

    const layoffsPanel = new NewsPanel('layoffs', t('panels.layoffs'));
    this.attachRelatedAssetHandlers(layoffsPanel);
    this.ctx.newsPanels['layoffs'] = layoffsPanel;
    this.ctx.panels['layoffs'] = layoffsPanel;

    const aiPanel = new NewsPanel('ai', t('panels.ai'));
    this.attachRelatedAssetHandlers(aiPanel);
    this.ctx.newsPanels['ai'] = aiPanel;
    this.ctx.panels['ai'] = aiPanel;

    const startupsPanel = new NewsPanel('startups', t('panels.startups'));
    this.attachRelatedAssetHandlers(startupsPanel);
    this.ctx.newsPanels['startups'] = startupsPanel;
    this.ctx.panels['startups'] = startupsPanel;

    const vcblogsPanel = new NewsPanel('vcblogs', t('panels.vcblogs'));
    this.attachRelatedAssetHandlers(vcblogsPanel);
    this.ctx.newsPanels['vcblogs'] = vcblogsPanel;
    this.ctx.panels['vcblogs'] = vcblogsPanel;

    const regionalStartupsPanel = new NewsPanel('regionalStartups', t('panels.regionalStartups'));
    this.attachRelatedAssetHandlers(regionalStartupsPanel);
    this.ctx.newsPanels['regionalStartups'] = regionalStartupsPanel;
    this.ctx.panels['regionalStartups'] = regionalStartupsPanel;

    const unicornsPanel = new NewsPanel('unicorns', t('panels.unicorns'));
    this.attachRelatedAssetHandlers(unicornsPanel);
    this.ctx.newsPanels['unicorns'] = unicornsPanel;
    this.ctx.panels['unicorns'] = unicornsPanel;

    const acceleratorsPanel = new NewsPanel('accelerators', t('panels.accelerators'));
    this.attachRelatedAssetHandlers(acceleratorsPanel);
    this.ctx.newsPanels['accelerators'] = acceleratorsPanel;
    this.ctx.panels['accelerators'] = acceleratorsPanel;

    const fundingPanel = new NewsPanel('funding', t('panels.funding'));
    this.attachRelatedAssetHandlers(fundingPanel);
    this.ctx.newsPanels['funding'] = fundingPanel;
    this.ctx.panels['funding'] = fundingPanel;

    const producthuntPanel = new NewsPanel('producthunt', t('panels.producthunt'));
    this.attachRelatedAssetHandlers(producthuntPanel);
    this.ctx.newsPanels['producthunt'] = producthuntPanel;
    this.ctx.panels['producthunt'] = producthuntPanel;

    const securityPanel = new NewsPanel('security', t('panels.security'));
    this.attachRelatedAssetHandlers(securityPanel);
    this.ctx.newsPanels['security'] = securityPanel;
    this.ctx.panels['security'] = securityPanel;

    const policyPanel = new NewsPanel('policy', t('panels.policy'));
    this.attachRelatedAssetHandlers(policyPanel);
    this.ctx.newsPanels['policy'] = policyPanel;
    this.ctx.panels['policy'] = policyPanel;

    const hardwarePanel = new NewsPanel('hardware', t('panels.hardware'));
    this.attachRelatedAssetHandlers(hardwarePanel);
    this.ctx.newsPanels['hardware'] = hardwarePanel;
    this.ctx.panels['hardware'] = hardwarePanel;

    const cloudPanel = new NewsPanel('cloud', t('panels.cloud'));
    this.attachRelatedAssetHandlers(cloudPanel);
    this.ctx.newsPanels['cloud'] = cloudPanel;
    this.ctx.panels['cloud'] = cloudPanel;

    const devPanel = new NewsPanel('dev', t('panels.dev'));
    this.attachRelatedAssetHandlers(devPanel);
    this.ctx.newsPanels['dev'] = devPanel;
    this.ctx.panels['dev'] = devPanel;

    const githubPanel = new NewsPanel('github', t('panels.github'));
    this.attachRelatedAssetHandlers(githubPanel);
    this.ctx.newsPanels['github'] = githubPanel;
    this.ctx.panels['github'] = githubPanel;

    const ipoPanel = new NewsPanel('ipo', t('panels.ipo'));
    this.attachRelatedAssetHandlers(ipoPanel);
    this.ctx.newsPanels['ipo'] = ipoPanel;
    this.ctx.panels['ipo'] = ipoPanel;

    const thinktanksPanel = new NewsPanel('thinktanks', t('panels.thinktanks'));
    this.attachRelatedAssetHandlers(thinktanksPanel);
    this.ctx.newsPanels['thinktanks'] = thinktanksPanel;
    this.ctx.panels['thinktanks'] = thinktanksPanel;

    const economicPanel = new EconomicPanel();
    this.ctx.panels['economic'] = economicPanel;

    const africaPanel = new NewsPanel('africa', t('panels.africa'));
    this.attachRelatedAssetHandlers(africaPanel);
    this.ctx.newsPanels['africa'] = africaPanel;
    this.ctx.panels['africa'] = africaPanel;

    const latamPanel = new NewsPanel('latam', t('panels.latam'));
    this.attachRelatedAssetHandlers(latamPanel);
    this.ctx.newsPanels['latam'] = latamPanel;
    this.ctx.panels['latam'] = latamPanel;

    const asiaPanel = new NewsPanel('asia', t('panels.asia'));
    this.attachRelatedAssetHandlers(asiaPanel);
    this.ctx.newsPanels['asia'] = asiaPanel;
    this.ctx.panels['asia'] = asiaPanel;

    const energyPanel = new NewsPanel('energy', t('panels.energy'));
    this.attachRelatedAssetHandlers(energyPanel);
    this.ctx.newsPanels['energy'] = energyPanel;
    this.ctx.panels['energy'] = energyPanel;

    for (const key of Object.keys(FEEDS)) {
      if (this.ctx.newsPanels[key]) continue;
      if (!Array.isArray((FEEDS as Record<string, unknown>)[key])) continue;
      const panelKey = this.ctx.panels[key] && !this.ctx.newsPanels[key] ? `${key}-news` : key;
      if (this.ctx.panels[panelKey]) continue;
      const panelConfig = DEFAULT_PANELS[panelKey] ?? DEFAULT_PANELS[key];
      const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const panel = new NewsPanel(panelKey, label);
      this.attachRelatedAssetHandlers(panel);
      this.ctx.newsPanels[key] = panel;
      this.ctx.panels[panelKey] = panel;
    }

    // Finance variant: Investments panel
    if (SITE_VARIANT === 'finance') {
      const investmentsPanel = new InvestmentsPanel((inv) => {
        focusInvestmentOnMap(this.ctx.map, this.ctx.mapLayers, inv.lat, inv.lon);
      });
      this.ctx.panels['gcc-investments'] = investmentsPanel;
    }

    // Live News and related panels (all non-happy variants)
    if (SITE_VARIANT !== 'happy') {
      const liveNewsPanel = new LiveNewsPanel();
      this.ctx.panels['live-news'] = liveNewsPanel;

      // Mount LiveNewsPanel to the livestream section (side-by-side with chart)
      const livestreamSection = document.getElementById('livestreamSection');
      if (livestreamSection) {
        const el = liveNewsPanel.getElement();
        el.classList.remove('panel-wide'); // Remove wide class for sidebar layout
        el.classList.add('livestream-panel');
        livestreamSection.appendChild(el);
      }

      this.ctx.panels['events'] = new TechEventsPanel('events');

      const serviceStatusPanel = new ServiceStatusPanel();
      this.ctx.panels['service-status'] = serviceStatusPanel;

      const techReadinessPanel = new TechReadinessPanel();
      this.ctx.panels['tech-readiness'] = techReadinessPanel;
    }

    if (this.ctx.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.ctx.panels['runtime-config'] = runtimeConfigPanel;
    }

    // Economic Calendar panel
    const economicCalendarPanel = new EconomicCalendarPanel();
    this.ctx.panels['economic-calendar'] = economicCalendarPanel;
    economicCalendarPanel.init().catch(err => {
      console.error('[PanelLayout] Failed to initialize EconomicCalendarPanel:', err);
    });

    // Global Giving panel
    this.ctx.panels['giving'] = new GivingPanel();

    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();
    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
      const insertIdx = valid.indexOf('politics') + 1 || 0;
      const newPanels = missing.filter(k => k !== 'monitors');
      valid.splice(insertIdx, 0, ...newPanels);
      if (SITE_VARIANT !== 'happy') {
        valid.push('monitors');
      }
      panelOrder = valid;
    }

    if (SITE_VARIANT !== 'happy') {
      // Remove live-news from panelOrder since it's now in livestreamSection
      const liveNewsIdx = panelOrder.indexOf('live-news');
      if (liveNewsIdx !== -1) {
        panelOrder.splice(liveNewsIdx, 1);
      }
    }

    if (this.ctx.isDesktopApp) {
      const runtimeIdx = panelOrder.indexOf('runtime-config');
      if (runtimeIdx > 1) {
        panelOrder.splice(runtimeIdx, 1);
        panelOrder.splice(1, 0, 'runtime-config');
      } else if (runtimeIdx === -1) {
        panelOrder.splice(1, 0, 'runtime-config');
      }
    }

    // Finance variant: ensure monitors is in panelOrder (replaces markets)
    if (SITE_VARIANT === 'finance') {
      // Ensure economic-calendar is in panelOrder
      if (!panelOrder.includes('economic-calendar')) {
        // Insert at position 1 (after first panel)
        panelOrder.splice(1, 0, 'economic-calendar');
      }
      if (!panelOrder.includes('monitors')) {
        // Insert monitors after economic-calendar (or at start if not found)
        const calendarIdx = panelOrder.indexOf('economic-calendar');
        panelOrder.splice(calendarIdx !== -1 ? calendarIdx + 1 : 0, 0, 'monitors');
      }
      // Remove markets from panelOrder since it's disabled in finance
      const marketsIdx = panelOrder.indexOf('markets');
      if (marketsIdx !== -1) {
        panelOrder.splice(marketsIdx, 1);
      }
      // Remove insights from panelOrder (replaced by economic-calendar)
      const insightsIdx = panelOrder.indexOf('insights');
      if (insightsIdx !== -1) {
        panelOrder.splice(insightsIdx, 1);
      }
      // Remove markets-news from panelOrder (disabled in finance, replaced by economic-calendar)
      const marketsNewsIdx = panelOrder.indexOf('markets-news');
      if (marketsNewsIdx !== -1) {
        panelOrder.splice(marketsNewsIdx, 1);
      }
    }

    panelOrder.forEach((key: string) => {
      const panel = this.ctx.panels[key];
      if (panel) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      }
    });

    // Map time range handler removed - Gold Trader uses chart time range instead
    this.applyPanelSettings();
    this.applyInitialUrlState();
  }

  private applyInitialUrlState(): void {
    if (!this.ctx.initialUrlState || !this.ctx.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.ctx.initialUrlState;

    if (view) {
      this.ctx.map.setView(view);
    }

    if (timeRange) {
      this.ctx.map.setTimeRange(timeRange);
    }

    if (layers) {
      this.ctx.mapLayers = layers;
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
      this.ctx.map.setLayers(layers);
    }

    if (!view) {
      if (zoom !== undefined) {
        this.ctx.map.setZoom(zoom);
      }
      if (lat !== undefined && lon !== undefined && zoom !== undefined && zoom > 2) {
        this.ctx.map.setCenter(lat, lon);
      }
    }

    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.ctx.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => this.ctx.map?.highlightAssets(assets),
      onRelatedAssetsClear: () => this.ctx.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    // Map removed for Gold Trader - related asset clicks are no-op
    if (!this.ctx.map) return;

    switch (asset.type) {
      case 'pipeline':
        this.ctx.map.enableLayer('pipelines');
        this.ctx.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        this.ctx.map.enableLayer('cables');
        this.ctx.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        this.ctx.map.enableLayer('datacenters');
        this.ctx.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        this.ctx.map.triggerDatacenterClick(asset.id);
        break;
      // Note: 'base' and 'nuclear' cases removed - map layers no longer exist
    }
  }

  private makeDraggable(el: HTMLElement, key: string): void {
    el.dataset.panel = key;
    let isDragging = false;
    let dragStarted = false;
    let startX = 0;
    let startY = 0;
    let rafId = 0;
    const DRAG_THRESHOLD = 8;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (el.dataset.resizing === 'true') return;
      if (target.classList?.contains('panel-resize-handle') || target.closest?.('.panel-resize-handle')) return;
      if (target.closest('button, a, input, select, textarea, .panel-content')) return;

      isDragging = true;
      dragStarted = false;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      if (!dragStarted) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        dragStarted = true;
        el.classList.add('dragging');
      }
      const cx = e.clientX;
      const cy = e.clientY;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        this.handlePanelDragMove(el, cx, cy);
        rafId = 0;
      });
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (dragStarted) {
        el.classList.remove('dragging');
        this.savePanelOrder();
      }
      dragStarted = false;
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    this.panelDragCleanupHandlers.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      isDragging = false;
      dragStarted = false;
      el.classList.remove('dragging');
    });
  }

  private handlePanelDragMove(dragging: HTMLElement, clientX: number, clientY: number): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;

    dragging.style.pointerEvents = 'none';
    const target = document.elementFromPoint(clientX, clientY);
    dragging.style.pointerEvents = '';

    if (!target) return;
    const targetPanel = target.closest('.panel') as HTMLElement | null;
    if (!targetPanel || targetPanel === dragging || targetPanel.classList.contains('hidden')) return;
    if (targetPanel.parentElement !== grid) return;

    const targetRect = targetPanel.getBoundingClientRect();
    const draggingRect = dragging.getBoundingClientRect();

    const children = Array.from(grid.children);
    const dragIdx = children.indexOf(dragging);
    const targetIdx = children.indexOf(targetPanel);
    if (dragIdx === -1 || targetIdx === -1) return;

    const sameRow = Math.abs(draggingRect.top - targetRect.top) < 30;
    const targetMid = sameRow
      ? targetRect.left + targetRect.width / 2
      : targetRect.top + targetRect.height / 2;
    const cursorPos = sameRow ? clientX : clientY;

    if (dragIdx < targetIdx) {
      if (cursorPos > targetMid) {
        grid.insertBefore(dragging, targetPanel.nextSibling);
      }
    } else {
      if (cursorPos < targetMid) {
        grid.insertBefore(dragging, targetPanel);
      }
    }
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }

  getAllSourceNames(): string[] {
    const sources = new Set<string>();
    Object.values(FEEDS).forEach(feeds => {
      if (feeds) feeds.forEach(f => sources.add(f.name));
    });
    INTEL_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }
}
