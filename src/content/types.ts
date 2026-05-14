export interface ResourceDict {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  oliveoil?: number;
  silver?: number;
}

export type ResourceKey = keyof Required<ResourceDict>;

export type NumberList = Array<number | string | null | undefined>;

export interface PlayerResources {
  timestamps?: NumberList;
  military?: NumberList;
  food?: NumberList;
  wood?: NumberList;
  gold?: NumberList;
  stone?: NumberList;
  oliveoil?: NumberList;
  silver?: NumberList;
  foodGathered?: NumberList;
  woodGathered?: NumberList;
  goldGathered?: NumberList;
  stoneGathered?: NumberList;
  oliveoilGathered?: NumberList;
  silverGathered?: NumberList;
  [key: string]: unknown;
}

export interface PlayerAnalysisLandmark {
  gameTime: number;
  newAge: number;
}

export interface PlayerAnalysis {
  landmarks?: PlayerAnalysisLandmark[];
}

export interface PlayerAgeUpTimes {
  feudalAge?: string;
  castleAge?: string;
  imperialAge?: string;
}

export interface BuildOrderItem {
  id?: string | number;
  type: 'Unit' | 'Building' | 'Upgrade' | string;
  icon: string;
  pbgid?: number;
  finished?: number[];
  destroyed?: number[];
  transformed?: number[];
  count?: number;
}

export interface PlayerSummary {
  name: string;
  team?: number;
  civilization?: string;
  civilizationAttrib?: string;
  color?: number;
  profileId?: number | string;
  buildOrder?: BuildOrderItem[];
  resources?: PlayerResources;
  analysis?: PlayerAnalysis;
  ageUpTimes?: PlayerAgeUpTimes;
  totalResourcesGathered?: Partial<Record<ResourceKey, number>>;
  resourcesGathered?: ResourceDict;
  resourcesSpent?: ResourceDict;
  [key: string]: unknown;
}

export interface GameSummary {
  players: PlayerSummary[];
  duration?: number;
  _aoe4ReplayPlayers?: ReplayPlayer[];
  [key: string]: unknown;
}

export interface ReplayPlayer {
  name: string;
  civilization?: string;
  color: number;
  slot?: number;
}

export interface PbgidEntry {
  n: string;
  i?: string;
  c?: string;
  k?: string;
  b?: string;
  u?: number;
}

export interface ChartSeries {
  key?: string;
  label: string;
  unitLabel?: string;
  mergeKey?: string;
  color: string;
  baseColor?: string;
  icon?: string;
  iconCandidates?: string[];
  createdTotal?: number;
  upgrades?: UnitUpgrade[];
  values: number[];
  sign?: number;
  playerName?: string;
  _finishedTimes?: number[];
  _destroyedTimes?: number[];
  _hidden?: boolean;
  _stackBase?: Float32Array;
  _stackTop?: Float32Array;
  _playerBase?: Float32Array | null;
  _playerTop?: Float32Array | null;
  _rawValues?: number[];
  team?: number;
  _areaIcon?: {
    url: string;
    entry: {
      img: HTMLImageElement;
      loaded: boolean;
    } | null;
  };
}

export interface UnitUpgrade {
  time: number;
  name: string;
}

export interface ChartData {
  labels: number[];
  series: ChartSeries[];
}

export interface ChartGeometry {
  yMin: number;
  yMax: number;
}

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Chart {
  type: string;
  value: string;
  title: string;
  meta?: string;
  options?: {
    height?: number;
    [key: string]: unknown;
  };
  data: ChartData;
  ageUps?: AgeUp[];
  _geometry?: ChartGeometry;
  _legendNodes?: Map<string, LegendNodeMeta>;
  _renderedY?: Map<string, Float32Array | StackedYCache>;
  _tooltipRows?: TooltipCacheRow[][];
  _cachedPlotH?: number;
  _cachedMarginTop?: number;
  _cachedYMin?: number;
  _cachedYMax?: number;
  highlightKey?: string | null;
  nativePlayerOrder?: string[];
}

export interface StackedYCache {
  stackBase: Float32Array;
  stackTop: Float32Array;
}

export interface LegendUnitNode {
  rowEl: HTMLElement;
  totalEl: HTMLElement;
  deltaTrainedEl: HTMLElement;
  deltaLostEl: HTMLElement;
  summaryTotal: number;
}

export interface LegendSummaryNode {
  panelEl: HTMLElement;
  summaryLabelEl: HTMLElement;
  chevronEl?: HTMLElement;
  rowEl?: HTMLElement;
  units: ChartSeries[];
}

export type LegendNodeMeta = LegendUnitNode | LegendSummaryNode;

export interface TimelineElements {
  root: HTMLElement & TimelineRootExtensions;
  select: HTMLSelectElement & {
    __aoe4SummaryActiveValue?: string;
    __aoe4SummaryCharts?: Map<string, Chart>;
    __aoe4SummaryListenerInstalled?: boolean;
  };
  chartBox: HTMLElement & ChartBoxExtensions;
  canvas: HTMLCanvasElement & CanvasExtensions;
  heading: HTMLElement;
  __aoe4Summary?: GameSummary;
  __aoe4NativeCanvas?: HTMLCanvasElement & CanvasExtensions;
  __aoe4OverlayResizeObserver?: ResizeObserver | null;
  __aoe4PlayerToggleHandlers?: PlayerToggleHandler[];
  __aoe4LegendPending?: boolean;
  __aoe4LegendChart?: Chart;
  __aoe4BuildOrderRetryScheduled?: boolean;
  __aoe4BuildOrderObserver?: MutationObserver | null;
}

export interface TimelineRootExtensions {
  __aoe4SummaryActiveChart?: Chart;
  __aoe4SummaryHoverGuard?: {
    guardHover: (event: Event) => void;
  };
  __aoe4GameId?: string;
  __aoe4ColorsRequestedFor?: string;
  __aoe4RouteToken?: number;
}

export interface ChartBoxExtensions {
  __aoe4ActiveRange?: RangeState | null;
  __aoe4ActiveDrag?: DragState | null;
  __aoe4DragAbort?: AbortController | null;
  __aoe4HoverActive?: boolean;
}

export interface CanvasExtensions {
  __aoe4SummaryHandlers?: CanvasTooltipHandlers;
  __aoe4SummarySuppress?: (event: MouseEvent) => void;
  __aoe4HoverActive?: boolean;
  __aoe4ActiveChart?: Chart | null;
  __aoe4AnimationFrame?: number | null;
  __aoe4AnimationToken?: symbol | null;
  __aoe4IconRedrawFrame?: number | null;
}

export interface RangeState {
  chartValue: string;
  startIdx: number;
  endIdx: number;
}

export interface DragState {
  chartValue: string;
  anchorIdx: number;
  currentIdx: number;
}

export interface AgeUp {
  gameTimeSec: number;
  label: string;
  color: string;
  playerName: string;
}

export interface AgeUpPlacementItem {
  ageUp: AgeUp;
  x: number;
  labelX: number;
  halfW: number;
  text: string;
  row: number;
}

export interface AgeUpPlacement {
  items: AgeUpPlacementItem[];
  rowCount: number;
}

export interface DrawAgeUpOptions {
  margin: ChartMargin;
  plotW: number;
  plotH: number;
  cssWidth: number;
  gameDuration: number;
  placement?: AgeUpPlacement | null;
}

export interface TooltipCacheRow {
  seriesIdx: number;
  value: number;
  previous: number;
  next: number;
  delta: number;
  isLeader?: boolean;
}

export interface TooltipRow {
  item: ChartSeries;
  value: number;
  delta?: number;
  previous?: number;
  next?: number;
  isClosest?: boolean;
  isLeader?: boolean;
}

export type ClosestSeriesKey = string | null;

export interface TooltipElement extends HTMLDivElement {
  __lastIndex?: number;
  __lastClosest?: ClosestSeriesKey;
}

export interface CanvasTooltipHandlers {
  onMove: (event: MouseEvent) => void;
  onLeave: (event: MouseEvent) => void;
  onMouseDown: ((event: MouseEvent) => void) | null;
  tooltip: TooltipElement | null;
  armyMiniTooltip: TooltipElement | null;
}

export interface PlayerToggleHandler {
  row: HTMLElement;
  onClick: (event: MouseEvent) => void;
  onEnter?: () => void;
  onLeave?: () => void;
}

export interface UnitDataEntry {
  id?: string;
  icon?: string;
  name?: string;
  displayName?: string;
  costs?: Record<string, number | string | null> | null;
}

export interface UnitDataSourceUnit {
  id?: string;
  baseId?: string;
  name?: string;
  icon?: string;
  age?: number;
  pbgid?: number;
  attribName?: string;
  classes?: string[];
  costs?: Record<string, number | string | null> | null;
}

export type UnitDataMap = Map<string, UnitDataEntry> & {
  __pbgidIndex?: Map<number, UnitDataEntry>;
};

export interface UnitGroup {
  finished: number[];
  destroyed: number[];
  upgrades: UnitUpgrade[];
  icon: string;
  pbgid?: number;
  label: string;
  mergeKey: string;
}

export interface UnitIconTarget {
  iconCandidates?: string[];
  iconUrl?: string;
  icon?: string;
  label?: string;
  unitLabel?: string;
}

export interface Settings {
  parseGameData: boolean;
  recolorSwatches: boolean;
  injectCharts: boolean;
  debugLogs: boolean;
}

export interface ReplayAvailabilityResult {
  available: boolean;
  prevPatch: boolean;
}
