(() => {
  const WINDOW_FLAG = '__aoe4ColorExtInjectorLoaded';
  type InjectorWindow = Window & { [WINDOW_FLAG]?: boolean };
  const injectorWindow = window as InjectorWindow;
  if (injectorWindow[WINDOW_FLAG]) {
    window.postMessage({ source: 'aoe4-color-ext', type: 'ready' }, '*');
    return;
  }
  injectorWindow[WINDOW_FLAG] = true;

  const COLOR_PROPS = ['borderColor', 'backgroundColor', 'pointBorderColor', 'pointBackgroundColor'] as const;
  type ColorProp = typeof COLOR_PROPS[number];
  type DatasetSourceColors = Partial<Record<ColorProp, string>>;

  type ChartDataset = {
    label?: string;
    borderColor?: unknown;
    backgroundColor?: unknown;
    pointBorderColor?: unknown;
    pointBackgroundColor?: unknown;
    __aoe4SourceColors?: DatasetSourceColors;
    __aoe4AppliedColors?: DatasetSourceColors;
  };

  type ChartInstance = {
    data?: {
      datasets?: ChartDataset[];
    };
    update(mode?: string): void;
    reset?(): void;
    stop?(): void;
  };

  type ChartPrototype = {
    update: (...args: unknown[]) => unknown;
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
  const EARLY_HIDE_STYLE_ID = '__aoe4-color-ext-hide';
  const HIDE_STYLE_ID = '__aoe4-color-ext-hide-active';
  const CHART_GATE_STYLE_ID = '__aoe4-color-ext-chart-gate';
  const ORIGINAL_STYLE_ATTR = 'data-aoe4-original-style';
  const RECOLOR_HINT_KEY = '__aoe4-color-ext-recolor-v1';
  let chartLib: ChartLibrary | null = null;
  let colorByName = new Map<string, string>();
  let patched = false;
  let domObserver: MutationObserver | null = null;
  let pendingRescan: number | null = null;
  const nameKeyFn = (name: unknown): string => String(name || '').trim().toLowerCase();

  function isGameRoute(): boolean {
    return /\/players\/\d+(?:-[^/]*)?\/games\/\d+/.test(window.location.pathname);
  }

  function readRecolorHint(): string | null {
    try { return localStorage.getItem(RECOLOR_HINT_KEY); }
    catch (_) { return null; }
  }

  function ensureChartGateStyle(): void {
    if (!isGameRoute()) return;
    if (document.getElementById(CHART_GATE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHART_GATE_STYLE_ID;
    style.textContent = `
      div:has(select option[value="army"]):has(select option[value="workers"])
        canvas:not([data-aoe4-summary-canvas]):not(.aoe4-ageup-overlay) {
        opacity: 0 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeChartGateStyle(): void {
    const style = document.getElementById(CHART_GATE_STYLE_ID);
    if (style) style.remove();
  }

  if (isGameRoute() && readRecolorHint() !== '0') {
    ensureChartGateStyle();
  }

  type ParsedHexColor = {
    base: string;
    alpha: string;
  };

  function parseHexColor(value: unknown): ParsedHexColor | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }
    const base = `#${hex.slice(0, 6).toUpperCase()}`;
    const alpha = hex.length === 8 ? hex.slice(6, 8).toUpperCase() : '';
    return { base, alpha };
  }

  function recoloredHex(replacement: string, alpha: string): string | null {
    const parsed = parseHexColor(replacement);
    if (!parsed) return null;
    return `${parsed.base}${alpha}`;
  }

  function recolorDatasetColor(
    dataset: ChartDataset,
    prop: ColorProp,
    replacement: string,
    replacementBase: string,
  ): boolean {
    const parsedCurrent = parseHexColor(dataset[prop]);
    if (!parsedCurrent) return false;

    if (parsedCurrent.base === replacementBase) return false;
    const sourceColors = dataset.__aoe4SourceColors ?? (dataset.__aoe4SourceColors = {});
    const appliedColors = dataset.__aoe4AppliedColors ?? (dataset.__aoe4AppliedColors = {});
    const sourceBase = sourceColors[prop];
    const appliedBase = appliedColors[prop];
    if (!sourceBase) {
      sourceColors[prop] = parsedCurrent.base;
    }
    if (sourceBase && parsedCurrent.base !== sourceBase && parsedCurrent.base !== appliedBase) return false;

    const next = recoloredHex(replacement, parsedCurrent.alpha);
    if (!next || dataset[prop] === next) return false;
    dataset[prop] = next;
    appliedColors[prop] = replacementBase;
    return true;
  }

  function restoreDatasetColors(dataset: ChartDataset): boolean {
    const sourceColors = dataset.__aoe4SourceColors;
    if (!sourceColors) return false;
    let changed = false;
    for (const prop of COLOR_PROPS) {
      const source = sourceColors[prop];
      if (!source) continue;
      const current = parseHexColor(dataset[prop]);
      const next = current ? `${source}${current.alpha}` : source;
      if (dataset[prop] !== next) {
        dataset[prop] = next;
        changed = true;
      }
    }
    delete dataset.__aoe4SourceColors;
    delete dataset.__aoe4AppliedColors;
    return changed;
  }

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
      const replacement = parseHexColor(hex);
      if (!replacement) continue;
      for (const prop of COLOR_PROPS) {
        if (recolorDatasetColor(ds, prop, hex, replacement.base)) {
          changed = true;
        }
      }
    }
    return changed;
  }

  function patchChartPrototype(Chart: ChartLibrary): void {
    if (patched) return;
    patched = true;

    const origUpdate = Chart.prototype.update;
    Chart.prototype.update = function patchedUpdate(this: ChartInstance, ...args: unknown[]): unknown {
      if (colorByName.size) {
        applyColorsToChart(this);
      }
      return origUpdate.apply(this, args);
    };
  }

  function updateChartAfterColorChange(chart: ChartInstance, animate: boolean): void {
    if (typeof chart.stop === 'function') chart.stop();
    if (animate) {
      if (typeof chart.reset === 'function') chart.reset();
      chart.update();
    } else {
      chart.update('none');
    }
  }

  let chartPatchObserver: MutationObserver | null = null;
  let chartPatchPromise: Promise<void> | null = null;
  let chartPatchFailed = false;

  function tryPatchChartLibrary(): void {
    if (patched || chartPatchPromise || chartPatchFailed) return;
    if (!findChartBundleUrl()) {
      if (document.readyState === 'complete') removeChartGateStyle();
      return;
    }
    chartPatchPromise = ensureChartLib()
      .then((Chart) => {
        patchChartPrototype(Chart);
        if (colorByName.size) applyToAllExistingCharts(Chart);
        removeChartGateStyle();
        if (chartPatchObserver) {
          chartPatchObserver.disconnect();
          chartPatchObserver = null;
        }
      })
      .catch((err: unknown) => {
        chartPatchFailed = true;
        if (chartPatchObserver) {
          chartPatchObserver.disconnect();
          chartPatchObserver = null;
        }
        const message = err instanceof Error ? err.message : String(err);
        window.postMessage({ source: SOURCE, type: 'error', error: message }, '*');
        removeChartGateStyle();
      })
      .finally(() => { chartPatchPromise = null; });
  }

  function ensureChartPatchObserver(): void {
    tryPatchChartLibrary();
    if (patched || chartPatchFailed || chartPatchObserver) return;
    chartPatchObserver = new MutationObserver(() => tryPatchChartLibrary());
    chartPatchObserver.observe(document.head || document.documentElement, { childList: true });
  }

  function applyToAllExistingCharts(Chart: ChartLibrary): number {
    if (!Chart || !Chart.instances) return 0;
    let updated = 0;
    for (const chart of Object.values(Chart.instances)) {
      if (applyColorsToChart(chart)) {
        try {
          updateChartAfterColorChange(chart, true);
          updated++;
        } catch (_) {}
      }
    }
    return updated;
  }

  function restoreAllChartColors(): number {
    if (!chartLib?.instances) return 0;
    let updated = 0;
    for (const chart of Object.values(chartLib.instances)) {
      const datasets = chart.data?.datasets;
      if (!Array.isArray(datasets)) continue;
      let changed = false;
      for (const ds of datasets) {
        if (restoreDatasetColors(ds)) changed = true;
      }
      if (!changed) continue;
      try {
        updateChartAfterColorChange(chart, false);
        updated++;
      } catch (_) {}
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

  function rememberOriginalStyle(el: HTMLElement): void {
    if (!el.hasAttribute(ORIGINAL_STYLE_ATTR)) {
      el.setAttribute(ORIGINAL_STYLE_ATTR, el.getAttribute('style') || '');
    }
  }

  function restoreOriginalStyle(el: HTMLElement): void {
    const original = el.getAttribute(ORIGINAL_STYLE_ATTR);
    if (original === null) return;
    if (original) el.setAttribute('style', original);
    else el.removeAttribute('style');
    el.removeAttribute(ORIGINAL_STYLE_ATTR);
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
    rememberOriginalStyle(span);
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
    rememberOriginalStyle(wrapper);
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

  function restoreDomSwatchColors(): void {
    document.querySelectorAll<HTMLSpanElement>(`span[${RECOLOR_ATTR}]`).forEach((el) => {
      restoreOriginalStyle(el);
      el.removeAttribute(RECOLOR_ATTR);
    });
    document.querySelectorAll<HTMLElement>(`i[${RECOLOR_ATTR}]`).forEach((el) => {
      if (el.parentElement instanceof HTMLElement) restoreOriginalStyle(el.parentElement);
      el.removeAttribute(RECOLOR_ATTR);
    });
    document.querySelectorAll<HTMLElement>(`[${ORIGINAL_STYLE_ATTR}]`).forEach(restoreOriginalStyle);
  }

  function removeHideStyle(): void {
    const hideStyle = document.getElementById(HIDE_STYLE_ID);
    if (hideStyle) hideStyle.remove();
  }

  function removeEarlyHideStyle(): void {
    const hideStyle = document.getElementById(EARLY_HIDE_STYLE_ID);
    if (hideStyle) hideStyle.remove();
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
    const map = payload?.colorByName;
    if (!map || typeof map !== 'object') return;
    colorByName = new Map<string, string>(Object.entries(map).map(([k, v]) => [nameKeyFn(k), v]));
    if (!colorByName.size) return;
    ensureHideStyle();
    removeEarlyHideStyle();
    ensureDomObserver();
    applyDomSwatchColors();
    ensureChartPatchObserver();
    if (chartLib) {
      applyToAllExistingCharts(chartLib);
      removeChartGateStyle();
    }
  }

  function handleClearColors(): void {
    colorByName = new Map<string, string>();
    restoreDomSwatchColors();
    restoreAllChartColors();
    removeHideStyle();
    removeEarlyHideStyle();
    removeChartGateStyle();
  }

  function handleDisableColors(): void {
    colorByName = new Map<string, string>();
    restoreDomSwatchColors();
    restoreAllChartColors();
    if (domObserver) {
      try { domObserver.disconnect(); } catch (_) {}
      domObserver = null;
    }
    if (pendingRescan) {
      try { cancelAnimationFrame(pendingRescan); } catch (_) {}
      pendingRescan = null;
    }
    if (chartPatchObserver) {
      try { chartPatchObserver.disconnect(); } catch (_) {}
      chartPatchObserver = null;
    }
    removeHideStyle();
    removeEarlyHideStyle();
    removeChartGateStyle();
  }

  window.addEventListener('message', (event: MessageEvent<WindowMessage>): void => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'ping') window.postMessage({ source: SOURCE, type: 'ready' }, '*');
    else if (data.type === 'colors-loading') ensureChartGateStyle();
    else if (data.type === 'colors-unavailable') {
      removeEarlyHideStyle();
      removeChartGateStyle();
    }
    else if (data.type === 'apply-colors') handleApplyColors(data);
    else if (data.type === 'clear-colors') handleClearColors();
    else if (data.type === 'disable-colors') handleDisableColors();
  });

  window.postMessage({ source: SOURCE, type: 'ready' }, '*');
})();
