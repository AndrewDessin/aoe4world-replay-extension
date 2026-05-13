(() => {
  type ChartDataset = {
    label?: string;
    borderColor?: unknown;
    backgroundColor?: string | ((...args: readonly unknown[]) => unknown);
    pointBorderColor?: unknown;
    pointBackgroundColor?: unknown;
  };

  type ChartElement = {
    options?: Record<string, unknown>;
    $animations?: Record<string, { _to?: unknown; _from?: unknown } | undefined>;
  };

  type ChartController = {
    _cachedDataOpts?: Record<string, unknown>;
    _resolverCache?: Record<string, unknown>;
  };

  type ChartMeta = {
    index: number;
    controller?: ChartController;
    dataset?: ChartElement;
    data?: ChartElement[];
    $animations?: Record<string, unknown>;
  };

  type ChartInstance = {
    data?: {
      datasets?: ChartDataset[];
    };
    update(mode?: string): void;
    getDatasetMeta?(index: number): ChartMeta;
  };

  type ChartPrototype = {
    update: (...args: unknown[]) => unknown;
  };

  type ChartPlugin = {
    id: string;
    beforeUpdate?: (chart: ChartInstance) => void;
  };

  type ChartLibrary = ((...args: unknown[]) => unknown) & {
    prototype: ChartPrototype;
    getChart: (...args: unknown[]) => unknown;
    instances: Record<string, ChartInstance>;
    register?: (...args: unknown[]) => void;
  };

  type ChartModule = Record<string, unknown>;

  type ApplyColorsPayload = {
    colorByName?: Record<string, string>;
  };

  type WindowMessage = ApplyColorsPayload & {
    source?: string;
    type?: string;
    error?: string;
  };

  const SOURCE = 'aoe4-color-ext';
  const RECOLOR_ATTR = 'data-aoe4-recolored';
  const HIDE_STYLE_ID = '__aoe4-color-ext-hide';
  let chartLib: ChartLibrary | null = null;
  let colorByName = new Map<string, string>();
  let disabled = false;
  let patched = false;
  let domObserver: MutationObserver | null = null;
  let pendingRescan: number | null = null;
  const nameKeyFn = (name: unknown): string => String(name || '').trim().toLowerCase();

  function findChartBundleUrl(): string | null {
    const candidates = [
      ...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
      ...document.querySelectorAll<HTMLScriptElement>('script[type="module"]'),
    ];
    for (const el of candidates) {
      const url = 'href' in el ? el.href : el.src;
      if (url && /\/chart-[a-f0-9]+\.js(?:\?|$)/i.test(url)) return url;
    }
    return null;
  }

  function findChartExport(mod: ChartModule): ChartLibrary | null {
    for (const value of Object.values(mod)) {
      const candidate = value as Partial<ChartLibrary> | undefined;
      if (typeof value === 'function' && typeof candidate?.getChart === 'function' && candidate.instances) {
        return value as unknown as ChartLibrary;
      }
    }
    return null;
  }

  async function ensureChartLib(): Promise<ChartLibrary> {
    if (chartLib) return chartLib;
    const url = findChartBundleUrl();
    if (!url) throw new Error('chart_bundle_not_found');
    const mod = await import(url) as ChartModule;
    const Chart = findChartExport(mod);
    if (!Chart) throw new Error('chart_export_not_found');
    chartLib = Chart;
    return Chart;
  }

  function applyColorsToChart(chart: ChartInstance | null | undefined): boolean {
    if (!chart || !chart.data || !Array.isArray(chart.data.datasets)) return false;
    if (!colorByName.size) return false;
    let changed = false;
    for (const ds of chart.data.datasets as ChartDataset[]) {
      const key = nameKeyFn(ds.label);
      if (!key) continue;
      const hex = colorByName.get(key);
      if (!hex) continue;
      if (ds.borderColor !== hex) { ds.borderColor = hex; changed = true; }
      if (typeof ds.backgroundColor !== 'function' && ds.backgroundColor !== hex) {
        ds.backgroundColor = hex; changed = true;
      }
      if (ds.pointBorderColor !== undefined && ds.pointBorderColor !== hex) {
        ds.pointBorderColor = hex; changed = true;
      }
      if (ds.pointBackgroundColor !== undefined && ds.pointBackgroundColor !== hex) {
        ds.pointBackgroundColor = hex; changed = true;
      }
    }
    return changed;
  }

  /** Clear Chart.js v4 internal option-resolver caches for a dataset.
   *  Without this, hover/animation cycles restore stale cached colors. */
  function resetChartColorCache(chart: ChartInstance, datasetIndex: number): void {
    if (!chart.getDatasetMeta) return;
    try {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta) return;
      const ctrl = meta.controller;
      if (ctrl) {
        if (ctrl._cachedDataOpts) ctrl._cachedDataOpts = {};
        if (ctrl._resolverCache) ctrl._resolverCache = {};
      }
      // Sync the line element's resolved options to our color
      const ds = chart.data?.datasets?.[datasetIndex];
      if (!ds) return;
      const hex = ds.borderColor;
      if (meta.dataset?.options) {
        meta.dataset.options.borderColor = hex;
        if (typeof ds.backgroundColor !== 'function') {
          meta.dataset.options.backgroundColor = ds.backgroundColor;
        }
      }
      // Kill any in-flight borderColor animation so it doesn't revert
      if (meta.dataset?.$animations?.borderColor) {
        meta.dataset.$animations.borderColor = undefined;
      }
      // Sync point elements
      if (meta.data) {
        for (const el of meta.data) {
          if (el.options) {
            el.options.borderColor = hex;
            if (typeof ds.backgroundColor !== 'function') {
              el.options.backgroundColor = ds.backgroundColor;
            }
          }
          if (el.$animations?.borderColor) {
            el.$animations.borderColor = undefined;
          }
        }
      }
    } catch (_) { /* defensive – internal API may vary */ }
  }

  let pluginRegistered = false;

  /** Register a Chart.js plugin that re-applies our colors before every
   *  update cycle (including hover-triggered ones). This ensures the
   *  option resolver always picks up our colors, not the cached originals. */
  function registerRecolorPlugin(Chart: ChartLibrary): void {
    if (pluginRegistered || !Chart.register) return;
    pluginRegistered = true;

    const plugin: ChartPlugin = {
      id: 'aoe4-persistent-recolor',
      beforeUpdate(chart: ChartInstance): void {
        if (!colorByName.size) return;
        applyColorsToChart(chart);
      },
    };
    Chart.register(plugin);
  }

  const coloredCharts = new WeakSet<ChartInstance>();
  function patchChartPrototype(Chart: ChartLibrary): void {
    if (patched) return;
    patched = true;
    registerRecolorPlugin(Chart);

    const origUpdate = Chart.prototype.update;
    Chart.prototype.update = function patchedUpdate(this: ChartInstance, ...args: unknown[]): unknown {
      if (colorByName.size && !coloredCharts.has(this)) {
        applyColorsToChart(this);
        coloredCharts.add(this);
        // Render once with 'none' so Chart.js parses our colors as the baseline
        origUpdate.call(this, 'none');
      }
      return origUpdate.apply(this, args);
    };
  }

  function applyToAllExistingCharts(Chart: ChartLibrary): number {
    if (!Chart || !Chart.instances) return 0;
    let updated = 0;
    for (const chart of Object.values(Chart.instances)) {
      if (applyColorsToChart(chart)) {
        coloredCharts.add(chart);
        try {
          if (typeof chart.stop === 'function') chart.stop();
          chart.update('none');
          updated++;
        } catch (_) {}
      }
    }
    return updated;
  }

  function findAdjacentPlayerName(startEl: Element | null | undefined): string | null {
    let cur = startEl?.nextElementSibling;
    let hops = 0;
    while (cur && hops < 4) {
      const text = (cur.textContent || '').trim();
      if (text && colorByName.has(nameKeyFn(text))) return nameKeyFn(text);
      cur = cur.nextElementSibling;
      hops++;
    }
    cur = startEl?.nextElementSibling;
    hops = 0;
    while (cur && hops < 4) {
      const inner = cur.firstElementChild?.textContent?.trim();
      if (inner && colorByName.has(nameKeyFn(inner))) return nameKeyFn(inner);
      cur = cur.nextElementSibling;
      hops++;
    }
    return null;
  }

  function recolorSpanSwatch(span: HTMLSpanElement): boolean {
    const nameKey = findAdjacentPlayerName(span);
    if (!nameKey) return false;
    const hex = colorByName.get(nameKey);
    if (!hex) return false;
    if (span.style.background === hex || span.style.backgroundColor === hex) {
      if (!span.hasAttribute(RECOLOR_ATTR)) span.setAttribute(RECOLOR_ATTR, '1');
      return false;
    }
    span.style.background = hex;
    span.style.backgroundColor = hex;
    span.setAttribute(RECOLOR_ATTR, '1');
    return true;
  }

  function recolorIconSwatch(icon: HTMLElement): boolean {
    const wrapper = icon.parentElement;
    if (!wrapper || !wrapper.style?.color) return false;
    const nameKey = findAdjacentPlayerName(wrapper);
    if (!nameKey) return false;
    const hex = colorByName.get(nameKey);
    if (!hex) return false;
    if (wrapper.style.color === hex) {
      if (!icon.hasAttribute(RECOLOR_ATTR)) icon.setAttribute(RECOLOR_ATTR, '1');
      return false;
    }
    wrapper.style.color = hex;
    icon.setAttribute(RECOLOR_ATTR, '1');
    return true;
  }

  function applyDomSwatchColors(): number {
    if (!colorByName.size) return 0;
    let count = 0;
    document.querySelectorAll<HTMLSpanElement>('span.rounded-full.w-2.h-2[style*="background"]').forEach((el) => {
      try { if (recolorSpanSwatch(el)) count++; } catch (_) {}
    });
    document.querySelectorAll<HTMLElement>('div[style*="color"] > i.fa-circle-check').forEach((el) => {
      try { if (recolorIconSwatch(el)) count++; } catch (_) {}
    });
    return count;
  }

  function scheduleDomRescan(): void {
    if (pendingRescan) return;
    pendingRescan = requestAnimationFrame((): void => {
      pendingRescan = null;
      applyDomSwatchColors();
    });
  }

  function ensureDomObserver(): void {
    if (domObserver) return;
    domObserver = new MutationObserver((mutations: MutationRecord[]): void => {
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          scheduleDomRescan();
          return;
        }
        if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
          scheduleDomRescan();
          return;
        }
      }
    });
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  function clearRecoloredAttrs(): void {
    document.querySelectorAll<HTMLElement>('[' + RECOLOR_ATTR + ']').forEach((el) => {
      el.removeAttribute(RECOLOR_ATTR);
    });
  }

  function ensureHideStyle(): void {
    if (document.getElementById(HIDE_STYLE_ID)) return;
    const css = `
      span.rounded-full.w-2.h-2[style*="background"]:not([${RECOLOR_ATTR}]) {
        opacity: 0 !important;
        transition: opacity 0.18s ease-in;
      }
      div[style*="color"] > i.fa-circle-check:not([${RECOLOR_ATTR}]) {
        opacity: 0 !important;
        transition: opacity 0.18s ease-in;
      }
      span.rounded-full.w-2.h-2[${RECOLOR_ATTR}],
      div[style*="color"] > i.fa-circle-check[${RECOLOR_ATTR}] {
        opacity: 1 !important;
      }
    `;
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  async function handleApplyColors(payload: ApplyColorsPayload | null | undefined): Promise<void> {
    if (disabled) return;
    const map = payload?.colorByName;
    if (!map || typeof map !== 'object') return;
    colorByName = new Map<string, string>(Object.entries(map).map(([k, v]) => [nameKeyFn(k), v]));
    if (!colorByName.size) return;
    ensureHideStyle();
    ensureDomObserver();
    applyDomSwatchColors();
    try {
      const Chart = await ensureChartLib();
      patchChartPrototype(Chart);
      applyToAllExistingCharts(Chart);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.postMessage({ source: SOURCE, type: 'error', error: message }, '*');
    }
  }

  function handleClearColors(): void {
    if (disabled) return;
    colorByName = new Map<string, string>();
    clearRecoloredAttrs();
    ensureHideStyle();
  }

  function handleDisableColors(): void {
    disabled = true;
    colorByName = new Map<string, string>();
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (pendingRescan) {
      try { cancelAnimationFrame(pendingRescan); } catch (_) {}
      pendingRescan = null;
    }
    const hideStyle = document.getElementById(HIDE_STYLE_ID);
    if (hideStyle) hideStyle.remove();
  }

  window.addEventListener('message', (event: MessageEvent<WindowMessage>): void => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'apply-colors') handleApplyColors(data);
    else if (data.type === 'clear-colors') handleClearColors();
    else if (data.type === 'disable-colors') handleDisableColors();
  });

  window.postMessage({ source: SOURCE, type: 'ready' }, '*');
})();
