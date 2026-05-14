import { findCivIconPosition } from './dom.ts';
import { armyIconElement, resolveCurrentUnitName } from './unit-icons.ts';
import { drawTimelineCanvasChart } from './canvas-render.ts';
import { getActiveRange, applyRangeLegend } from './range.ts';
import type {
  Chart,
  ChartSeries,
  LegendNodeMeta,
  LegendSummaryNode,
  LegendUnitNode,
  TimelineElements,
} from './types.ts';

function isSummaryNode(key: string, _meta: LegendNodeMeta): _meta is LegendSummaryNode {
  return key.startsWith('__summary__');
}

function isUnitNode(key: string, _meta: LegendNodeMeta): _meta is LegendUnitNode {
  return !key.startsWith('__summary__');
}

export function renderArmyUnitLegend(timeline: TimelineElements, chart: Chart): void {
  timeline.__aoe4LegendChart = chart;
  if (timeline.__aoe4LegendPending) return;
  timeline.__aoe4LegendPending = true;
  requestAnimationFrame(() => {
    timeline.__aoe4LegendPending = false;
    const latestChart = timeline.__aoe4LegendChart ?? chart;
    renderArmyUnitLegendNow(timeline, latestChart);
    timeline.__aoe4LegendChart = undefined;
  });
}

export function renderArmyUnitLegendNow(timeline: TimelineElements, chart: Chart): void {
  removeArmyUnitLegend(timeline);
  if (chart.highlightKey) {
    delete chart.highlightKey;
    drawTimelineCanvasChart(timeline.canvas, chart);
  }
  const legendNodes = new Map<string, LegendNodeMeta>();
  chart._legendNodes = legendNodes;

  const byPlayer = new Map<string, ChartSeries[]>();
  for (const item of chart.data.series) {
    if (!item.playerName) continue;
    if (!byPlayer.has(item.playerName)) byPlayer.set(item.playerName, []);
    byPlayer.get(item.playerName)?.push(item);
  }

  const playerRows = [...timeline.root.querySelectorAll<HTMLElement>('.flex.items-center.cursor-pointer')];
  const rowByPlayerName = new Map<string, HTMLElement>();
  for (const candidate of playerRows) {
    const candidateNameEl = candidate.querySelector<HTMLElement>('.font-bold, [class*="font-bold"]');
    const rawName = (candidateNameEl?.textContent || '').trim().toLowerCase();
    if (rawName && !rowByPlayerName.has(rawName)) rowByPlayerName.set(rawName, candidate);
  }

  const usedRows = new Set<HTMLElement>();
  for (const [playerName, units] of byPlayer.entries()) {
    const key = playerName.trim().toLowerCase();
    let row = rowByPlayerName.get(key);
    if (!row) {
      for (const [name, candidate] of rowByPlayerName.entries()) {
        if (name.startsWith(key) || key.startsWith(name)) {
          row = candidate;
          break;
        }
      }
    }
    if (!row || usedRows.has(row)) continue;
    const container = row.parentElement;
    if (!container) continue;
    usedRows.add(row);

    const basisContainer = row.closest<HTMLElement>('[class*="basis-"]');
    if (basisContainer) {
      basisContainer.style.minWidth = '0';
      basisContainer.style.overflow = '';
      basisContainer.style.overflowY = '';
      basisContainer.style.maxHeight = '';
    }
    container.style.overflow = 'hidden';
    container.style.minWidth = '0';
    row.style.minWidth = '0';
    row.style.overflow = 'hidden';

    const nameEl = row.querySelector<HTMLElement>('.font-bold, [class*="font-bold"]');
    if (nameEl) {
      nameEl.style.maxWidth = '8rem';
      nameEl.style.overflow = 'hidden';
      nameEl.style.textOverflow = 'ellipsis';
      nameEl.style.whiteSpace = 'nowrap';
      nameEl.style.flexShrink = '0';
    }

    const sortedUnits = units.sort((a: ChartSeries, b: ChartSeries) => (b.createdTotal || 0) - (a.createdTotal || 0));
    const inlineSummary = document.createElement('span');
    inlineSummary.className = 'aoe4-inline-legend-summary';
    inlineSummary.textContent = sortedUnits.map(u => u.unitLabel || u.label || '').join(', ');
    inlineSummary.title = sortedUnits
      .map(u => `${u.unitLabel || u.label || ''}: ${u.createdTotal || 0}`)
      .join('\n');

    const chevron = document.createElement('span');
    chevron.className = 'aoe4-inline-legend-chevron';
    const collapsedText = '▾';
    const expandedText = 'Hide ▴';
    chevron.textContent = collapsedText;

    const insertBefore = findCivIconPosition(row);
    if (insertBefore) {
      row.insertBefore(chevron, insertBefore);
      row.insertBefore(inlineSummary, chevron);
    } else {
      row.append(inlineSummary, chevron);
    }
    row.dataset.aoe4LegendInjected = '1';

    const panel = document.createElement('div');
    panel.className = 'aoe4-legend-breakdown';
    panel.style.display = 'none';
    panel.dataset.playerName = playerName;
    for (const unit of sortedUnits) {
      panel.appendChild(armyLegendUnitRow(timeline, chart, unit, playerName, legendNodes));
    }
    container.insertBefore(panel, row.nextSibling);

    legendNodes.set(`__summary__${playerName}`, {
      summaryLabelEl: inlineSummary,
      chevronEl: chevron,
      panelEl: panel,
      units: sortedUnits,
      rowEl: row,
    });

    const is1v1 = byPlayer.size <= 2;
    if (is1v1 || row.dataset.aoe4LegendOpen === '1') {
      panel.style.display = '';
      chevron.textContent = expandedText;
      inlineSummary.style.display = 'none';
      row.dataset.aoe4LegendOpen = '1';
    }

    const toggleLegend = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = panel.style.display !== 'none';
      panel.style.display = isOpen ? 'none' : '';
      chevron.textContent = isOpen ? collapsedText : expandedText;
      inlineSummary.style.display = isOpen ? '' : 'none';
      row.dataset.aoe4LegendOpen = isOpen ? '0' : '1';
      if (!isOpen && chart.type === 'army' && getActiveRange(timeline.chartBox, chart)) {
        applyRangeLegend(chart, timeline);
      }
      if (chart.type === 'army') {
        if (!isOpen && chart.highlightKey) {
          const hl = chart.data.series.find((seriesItem: ChartSeries) => seriesItem.key === chart.highlightKey);
          if (hl && hl.playerName === playerName) chart.highlightKey = null;
        }
        drawTimelineCanvasChart(timeline.canvas, chart);
        const mini = timeline.canvas.__aoe4SummaryHandlers?.armyMiniTooltip;
        if (mini) {
          mini.__lastIndex = undefined;
          mini.__lastClosest = undefined;
        }
      }
    };

    chevron.addEventListener('click', toggleLegend);
    inlineSummary.addEventListener('click', toggleLegend);
  }

  if (chart.type === 'army') {
    if (!timeline.canvas.__aoe4AnimationToken) drawTimelineCanvasChart(timeline.canvas, chart);
  }
}

export function armyLegendUnitRow(
  timeline: TimelineElements,
  chart: Chart,
  unit: ChartSeries,
  _playerName: string,
  legendNodes?: Map<string, LegendNodeMeta> | null,
): HTMLDivElement {
  const unitRow = document.createElement('div');
  unitRow.className = 'aoe4-army-unit-row';
  unitRow.dataset.seriesKey = unit.key || '';

  const name = document.createElement('span');
  name.className = 'aoe4-army-unit-name';
  name.textContent = unit.unitLabel || unit.label || '';

  const total = document.createElement('span');
  total.className = 'aoe4-army-unit-total';
  total.textContent = Math.round(unit.createdTotal || 0).toLocaleString();

  const deltaTrained = document.createElement('span');
  deltaTrained.className = 'aoe4-army-unit-delta-trained';
  const deltaLost = document.createElement('span');
  deltaLost.className = 'aoe4-army-unit-delta-lost';
  unitRow.append(armyIconElement(unit), name, total, deltaTrained, deltaLost);

  if (legendNodes && unit.key) {
    legendNodes.set(unit.key, {
      totalEl: total,
      deltaTrainedEl: deltaTrained,
      deltaLostEl: deltaLost,
      rowEl: unitRow,
      summaryTotal: unit.createdTotal || 0,
    });
  }

  unitRow.addEventListener('mouseenter', () => {
    chart.highlightKey = unit.key;
    unitRow.classList.add('is-highlighted');
    drawTimelineCanvasChart(timeline.canvas, chart);
  });
  unitRow.addEventListener('mouseleave', () => {
    delete chart.highlightKey;
    unitRow.classList.remove('is-highlighted');
    drawTimelineCanvasChart(timeline.canvas, chart);
  });
  return unitRow;
}

export function seriesColorChip(color: string | null | undefined): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'aoe4-series-color-chip';
  chip.style.backgroundColor = color || '#94a3b8';
  return chip;
}

export function removeArmyUnitLegend(timeline: TimelineElements | null | undefined): void {
  const root = (timeline as TimelineElements | null | undefined)?.root;
  if (!root) return;
  root.querySelectorAll<HTMLElement>('.aoe4-army-unit-legend').forEach(node => node.remove());
  root.querySelectorAll<HTMLElement>('.aoe4-inline-legend-summary').forEach(node => node.remove());
  root.querySelectorAll<HTMLElement>('.aoe4-inline-legend-chevron').forEach(node => node.remove());
  root.querySelectorAll<HTMLElement>('.aoe4-legend-breakdown').forEach(node => node.remove());
  root.querySelectorAll<HTMLElement>('[data-aoe4-legend-injected]').forEach(node => {
    delete node.dataset.aoe4LegendInjected;
    const basis = node.closest<HTMLElement>('[class*="basis-"]');
    if (basis) {
      basis.style.maxHeight = '';
      basis.style.overflowY = '';
      basis.style.overflow = '';
      basis.style.minWidth = '';
    }
    const nameEl = node.querySelector<HTMLElement>('.font-bold, [class*="font-bold"]');
    if (nameEl) {
      nameEl.style.maxWidth = '';
      nameEl.style.overflow = '';
      nameEl.style.textOverflow = '';
      nameEl.style.whiteSpace = '';
      nameEl.style.flexShrink = '';
    }
  });
}

export function refreshArmyLegendNames(timeline: TimelineElements, chart: Chart): void {
  const nodes = chart._legendNodes;
  if (!nodes || !nodes.size) return;
  const hoverActive = !!(timeline.chartBox.__aoe4HoverActive || timeline.canvas.__aoe4HoverActive);
  if (hoverActive) return;
  const rangeActive = !!getActiveRange(timeline.chartBox, chart);

  for (const item of chart.data.series) {
    if (!item.key) continue;
    const node = nodes.get(item.key);
    if (!node || !isUnitNode(item.key, node)) continue;
    const nameEl = node.rowEl.querySelector<HTMLElement>('.aoe4-army-unit-name');
    if (!nameEl) continue;
    const fresh = resolveCurrentUnitName(item);
    if (fresh && nameEl.textContent !== fresh) {
      nameEl.textContent = fresh;
      item.unitLabel = fresh;
    }
  }

  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    for (const unit of meta.units) {
      const fresh = resolveCurrentUnitName(unit);
      if (fresh) unit.unitLabel = fresh;
    }
    if (rangeActive) continue;
    const text = meta.units.map(unit => unit.unitLabel || unit.label || '').join(', ');
    if (meta.summaryLabelEl.textContent !== text) meta.summaryLabelEl.textContent = text;
  }
}
