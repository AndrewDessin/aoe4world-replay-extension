import type { Chart, LegendNodeMeta, LegendSummaryNode, LegendUnitNode } from './types.ts';

function isSummaryNode(key: string, _meta: LegendNodeMeta): _meta is LegendSummaryNode {
  return key.startsWith('__summary__');
}

function isUnitNode(key: string, _meta: LegendNodeMeta): _meta is LegendUnitNode {
  return !key.startsWith('__summary__');
}

export function updateLegendLive(chart: Chart, index: number, closestKey: string | null | undefined): void {
  const nodes = chart._legendNodes;
  if (!nodes || !nodes.size) return;

  const expandedPlayers = new Set<string>();
  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    if (meta.panelEl.style.display !== 'none') {
      expandedPlayers.add(key.slice(11));
    }
  }

  const series = chart.data.series;
  const numSamples = chart.data.labels.length;
  for (const item of series) {
    if (!item.key || !item.playerName || !expandedPlayers.has(item.playerName)) continue;
    const node = nodes.get(item.key);
    if (!node || !isUnitNode(item.key, node)) continue;
    const value = Math.abs(item.values[index] || 0);
    const previous = index > 0 ? Math.abs(item.values[index - 1] || 0) : value;
    const next = index < numSamples - 1 ? Math.abs(item.values[index + 1] || 0) : value;
    const delta = value - previous;

    const isTransition = value === 0 && (previous !== 0 || next !== 0);
    if (value === 0 && !isTransition) {
      node.rowEl.style.display = 'none';
      continue;
    }
    node.rowEl.style.display = '';

    const text = String(Math.round(value));
    if (node.totalEl.textContent !== text) node.totalEl.textContent = text;
    if (delta === 0) setDeltaCells(node, null, null);
    else if (delta > 0) setDeltaCells(node, delta, 0);
    else setDeltaCells(node, 0, -delta);
    if (closestKey === item.key) node.rowEl.classList.add('is-closest');
    else node.rowEl.classList.remove('is-closest');
  }

  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    const parts: string[] = [];
    for (const u of meta.units) {
      const val = Math.abs(u.values[index] || 0);
      if (val > 0) parts.push(`${u.unitLabel || u.label}: ${Math.round(val)}`);
    }
    const text = parts.join(', ') || '—';
    if (meta.summaryLabelEl.textContent !== text) meta.summaryLabelEl.textContent = text;
  }
}

export function resetLegendSummary(chart: Chart): void {
  const nodes = chart._legendNodes;
  if (!nodes) return;

  for (const [key, node] of nodes) {
    if (!isUnitNode(key, node)) continue;
    node.rowEl.style.display = '';
    const text = Math.round(node.summaryTotal).toLocaleString();
    if (node.totalEl.textContent !== text) node.totalEl.textContent = text;
    setDeltaCells(node, null, null);
    node.rowEl.classList.remove('is-closest');
  }

  for (const [key, meta] of nodes) {
    if (!isSummaryNode(key, meta)) continue;
    const text = meta.units.map(u => u.unitLabel || u.label || '').join(', ');
    if (meta.summaryLabelEl.textContent !== text) meta.summaryLabelEl.textContent = text;
  }
}

export function setDeltaCells(node: LegendUnitNode | null | undefined, trained: number | null, lost: number | null): void {
  if (!node?.deltaTrainedEl || !node?.deltaLostEl) return;
  if (trained == null && lost == null) {
    if (node.deltaTrainedEl.textContent !== '') node.deltaTrainedEl.textContent = '';
    if (node.deltaLostEl.textContent !== '') node.deltaLostEl.textContent = '';
    node.deltaTrainedEl.classList.remove('is-zero');
    node.deltaLostEl.classList.remove('is-zero');
    return;
  }
  const t = String(Math.round(trained || 0));
  const l = String(Math.round(lost || 0));
  if (node.deltaTrainedEl.textContent !== t) node.deltaTrainedEl.textContent = t;
  if (node.deltaLostEl.textContent !== l) node.deltaLostEl.textContent = l;
  node.deltaTrainedEl.classList.toggle('is-zero', (trained || 0) === 0);
  node.deltaLostEl.classList.toggle('is-zero', (lost || 0) === 0);
}
