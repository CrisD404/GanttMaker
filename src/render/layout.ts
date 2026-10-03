import {
  addMonths, formatShort, fromYmd, isWorkday, monthLong, monthShort, startOfMonth, startOfQuarter,
  startOfWeek, startOfYear, weekdayLetter, ymd, type Day,
} from '../core/dates';
import { hasSprints, sprintsInRange } from '../core/sprints';
import type { Column, GanttDoc, SectionNode, Sprint, TaskNode, ViewSettings } from '../core/types';

export interface Row {
  kind: 'section' | 'task';
  key: string;
  depth: number;
  index: number;
  y: number;
  label: string;
  task?: TaskNode;
  section: SectionNode;
  start: Day;
  end: Day;
  color: string;
  /** Tiene hijos (visibles o no). */
  hasChildren: boolean;
  /** Sus hijos están ocultos (colapsado o por nivel de detalle). */
  folded: boolean;
  /** Hitos internos que no se ven porque la fila está plegada. */
  innerMilestones: { day: Day; label: string }[];
  /** No coincide con el filtro rápido en modo "atenuar". */
  dimmed: boolean;
}

export interface Tick {
  key: string;
  x: number;
  w: number;
  label: string;
  /** Período que representa (fin exclusivo): para "ajustar al período". */
  start: Day;
  end: Day;
  strong?: boolean;
  /** Texto largo para el tooltip. */
  title?: string;
}

export interface ColumnDef {
  key: 'name' | Column;
  label: string;
  width: number;
}

export interface DepLink {
  key: string;
  from: Row;
  to: Row;
  critical: boolean;
  dimmed: boolean;
}

export interface Layout {
  rows: Row[];
  rowByKey: Map<string, Row>;
  rowH: number;
  headerH: number;
  columns: ColumnDef[];
  gridW: number;
  rangeStart: Day;
  rangeEnd: Day;
  pxPerDay: number;
  width: number;
  height: number;
  top: Tick[];
  bottom: Tick[];
  /** Fila extra de sprints en el encabezado (cuando la escala no es "sprint"). */
  sprintTier: Tick[];
  sprints: Sprint[];
  nonWorking: { x: number; w: number }[];
  deps: DepLink[];
  today: Day;
  /** Cantidad de tareas que coinciden con los filtros (para el dock). */
  matchCount: number;
  totalCount: number;
}

export const BASE_PX_PER_DAY: Record<ViewSettings['scale'], number> = {
  day: 40,
  week: 22,
  sprint: 12,
  month: 4.5,
  quarter: 1.6,
  year: 0.45,
};

export const ROW_HEIGHT: Record<ViewSettings['density'], number> = {
  compact: 28,
  normal: 36,
  comfortable: 46,
};

export const HEADER_TIER = { top: 24, bottom: 32, sprint: 20 };

const COLUMN_DEFS: Record<'name' | Column, { label: string; width: number }> = {
  name: { label: 'Tarea', width: 248 },
  owner: { label: 'Responsable', width: 128 },
  start: { label: 'Inicio', width: 88 },
  end: { label: 'Fin', width: 88 },
  duration: { label: 'Duración', width: 78 },
  progress: { label: 'Avance', width: 80 },
};

export const STATUS_COLORS = {
  done: '#22c55e',
  active: '#5b5bf7',
  blocked: '#ef4444',
  none: '#94a3b8',
};

export function taskColor(t: TaskNode, doc: GanttDoc, s: ViewSettings): string {
  if (t.spec.color) return t.spec.color;
  if (s.colorBy === 'status') return STATUS_COLORS[t.status ?? 'none'];
  if (s.colorBy === 'owner') {
    const o = t.spec.owners[0] ? doc.owners.get(t.spec.owners[0].toLowerCase()) : undefined;
    if (o) return o.color;
    // Los padres sin responsable toman el color de su primer hijo con responsable
    for (const c of t.children) {
      const cc = taskColor(c, doc, s);
      if (cc) return cc;
    }
  }
  return t.section.color ?? '#64748b';
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

/** Filtro rápido (no se escribe en el código hasta "Guardar en vista"). */
export interface QuickFilter {
  owners: string[];
  tags: string[];
  text: string;
  mode: 'hide' | 'dim';
}

export const EMPTY_QUICK: QuickFilter = { owners: [], tags: [], text: '', mode: 'hide' };

export function quickActive(q: QuickFilter): boolean {
  return q.owners.length > 0 || q.tags.length > 0 || q.text.trim() !== '';
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Criteria {
  owners: string[];
  tags: string[];
  text: string;
}

/** ¿La tarea (sola, sin mirar descendientes) cumple el criterio? */
export function matchesCriteria(t: TaskNode, doc: GanttDoc, c: Criteria): boolean {
  if (c.owners.length) {
    const wanted = c.owners.map((o) => o.toLowerCase());
    const ok = t.spec.owners.some((o) => {
      const key = o.toLowerCase();
      if (wanted.includes(key)) return true;
      const team = doc.owners.get(key)?.team?.toLowerCase();
      return !!team && wanted.includes(team);
    });
    if (!ok) return false;
  }
  if (c.tags.length) {
    const tags = [...t.spec.tags, ...(t.status ? [t.status] : []), ...(t.spec.milestone ? ['milestone'] : [])];
    if (!c.tags.some((x) => tags.includes(x))) return false;
  }
  const text = fold(c.text.trim());
  if (text) {
    const hay = fold([t.spec.name, ...t.spec.owners, ...t.spec.tags].join(' '));
    if (!text.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function collectMilestones(t: TaskNode, out: { day: Day; label: string }[]) {
  for (const c of t.children) {
    if (c.spec.milestone) out.push({ day: c.start, label: c.spec.name });
    collectMilestones(c, out);
  }
}

export interface LayoutInput {
  doc: GanttDoc;
  settings: ViewSettings;
  collapsed: Set<string>;
  zoom: number;
  today: Day;
  /** Ancho mínimo del área del gráfico (para llenar el viewport). */
  minChartWidth: number;
  /** Píxeles por día a usar (durante la animación de zoom). Si falta, se usa escala × zoom. */
  pxPerDay?: number;
  quick?: QuickFilter;
}

export function computeLayout({ doc, settings: s, collapsed, zoom, today, minChartWidth, pxPerDay: pxOverride, quick = EMPTY_QUICK }: LayoutInput): Layout {
  const rowH = ROW_HEIGHT[s.density];
  const viewCrit: Criteria = { owners: s.filterOwners, tags: s.filterTags, text: s.filterText };
  const viewFiltering = viewCrit.owners.length > 0 || viewCrit.tags.length > 0 || viewCrit.text.trim() !== '';
  const quickOn = quickActive(quick);
  const hideQuick = quickOn && quick.mode === 'hide';
  const dimQuick = quickOn && quick.mode === 'dim';
  const filtering = viewFiltering || hideQuick;

  // --- Visibilidad (una tarea es visible si ella o algún descendiente coincide) ---
  const visible = new Map<TaskNode, boolean>();
  const quickMatch = new Map<TaskNode, boolean>();
  let matchCount = 0;
  const evalTask = (t: TaskNode): void => {
    t.children.forEach(evalTask);
    const selfView = !viewFiltering || matchesCriteria(t, doc, viewCrit);
    const selfQuick = !quickOn || matchesCriteria(t, doc, quick);
    const kidsVisible = t.children.some((c) => visible.get(c));
    const kidsQuick = t.children.some((c) => quickMatch.get(c));
    quickMatch.set(t, selfQuick || kidsQuick);
    visible.set(t, (selfView && (!hideQuick || selfQuick)) || kidsVisible);
    if (!t.children.length && selfView && selfQuick) matchCount++;
  };
  for (const sec of doc.sections) sec.tasks.forEach(evalTask);
  const totalCount = doc.tasks.filter((t) => !t.children.length).length;

  // --- Filas ---
  const rows: Row[] = [];
  const push = (r: Omit<Row, 'index' | 'y'>) => {
    const index = rows.length;
    rows.push({ ...r, index, y: index * rowH });
  };

  const addTask = (t: TaskNode, level: number) => {
    if (!visible.get(t)) return;
    const visibleChildren = t.children.filter((c) => visible.get(c));
    const hasChildren = visibleChildren.length > 0;
    const folded = hasChildren && (collapsed.has(t.key) || level + 1 > s.detail);
    const inner: { day: Day; label: string }[] = [];
    if (folded) collectMilestones(t, inner);
    push({
      kind: 'task',
      key: t.key,
      depth: t.depth,
      label: t.spec.name,
      task: t,
      section: t.section,
      start: t.start,
      end: t.end,
      color: taskColor(t, doc, s),
      hasChildren,
      folded,
      innerMilestones: inner,
      dimmed: dimQuick && !quickMatch.get(t),
    });
    if (!folded) for (const c of visibleChildren) addTask(c, level + 1);
  };

  for (const sec of doc.sections) {
    const tasks = sec.tasks.filter((t) => visible.get(t));
    if (filtering && !tasks.length) continue;
    if (sec.line < 0) {
      // Sección implícita: las tareas van al primer nivel
      for (const t of tasks) addTask(t, 1);
      continue;
    }
    const folded = collapsed.has(sec.key) || s.detail < 2;
    const inner: { day: Day; label: string }[] = [];
    if (folded) for (const t of tasks) {
      if (t.spec.milestone) inner.push({ day: t.start, label: t.spec.name });
      collectMilestones(t, inner);
    }
    const start = tasks.length ? Math.min(...tasks.map((t) => t.start)) : sec.start;
    const end = tasks.length ? Math.max(...tasks.map((t) => t.end)) : sec.end;
    push({
      kind: 'section',
      key: sec.key,
      depth: -1,
      label: sec.name,
      section: sec,
      start,
      end,
      color: sec.color ?? '#64748b',
      hasChildren: tasks.length > 0,
      folded,
      innerMilestones: inner,
      dimmed: dimQuick && !tasks.some((t) => quickMatch.get(t)),
    });
    if (!folded) for (const t of tasks) addTask(t, 2);
  }

  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  // --- Rango temporal ---
  const pxPerDay = pxOverride ?? BASE_PX_PER_DAY[s.scale] * zoom;
  let rangeStart: Day;
  let rangeEnd: Day;
  if (s.range) {
    [rangeStart, rangeEnd] = s.range;
  } else {
    const all = doc.tasks;
    const min = all.length ? Math.min(...all.map((t) => t.start)) : today;
    const max = all.length ? Math.max(...all.map((t) => t.end)) : today + 30;
    rangeStart = alignStart(s.scale, min);
    rangeEnd = alignEnd(s.scale, max);
    if (s.scale === 'sprint') {
      // Alinear a los bordes de sprint
      const sp = sprintsInRange(doc, min, max + 1, true);
      if (sp.length) {
        rangeStart = Math.min(rangeStart, sp[0].start);
        rangeEnd = Math.max(rangeEnd, sp[sp.length - 1].end);
      }
    }
  }
  const minDays = Math.ceil(minChartWidth / pxPerDay);
  if (rangeEnd - rangeStart < minDays) rangeEnd = rangeStart + minDays;

  const width = Math.ceil((rangeEnd - rangeStart) * pxPerDay);
  const x = (d: Day) => (d - rangeStart) * pxPerDay;

  // --- Sprints ---
  const showSprints = s.scale === 'sprint' || (s.features.sprints && hasSprints(doc));
  const sprints = showSprints ? sprintsInRange(doc, rangeStart, rangeEnd, s.scale === 'sprint') : [];
  const sprintTicks: Tick[] = sprints.map((sp) => {
    const a = Math.max(sp.start, rangeStart), b = Math.min(sp.end, rangeEnd);
    return {
      key: `s${sp.start}`, x: x(a), w: (b - a) * pxPerDay, label: sp.name, start: sp.start, end: sp.end,
      title: `${sp.name}: ${formatShort(sp.start)} – ${formatShort(sp.end - 1)}`,
    };
  });

  // --- Marcas del eje (se adaptan al zoom) ---
  const { top, bottom } = buildTicks(s.scale, rangeStart, rangeEnd, x, pxPerDay, sprintTicks);
  const sprintTier = s.scale !== 'sprint' && sprintTicks.length ? sprintTicks : [];
  const headerH = HEADER_TIER.top + HEADER_TIER.bottom + (sprintTier.length ? HEADER_TIER.sprint : 0);

  // --- Días no laborables ---
  const nonWorking: { x: number; w: number }[] = [];
  if (s.features.weekends && pxPerDay >= 6) {
    let runStart: Day | null = null;
    for (let d = rangeStart; d <= rangeEnd; d++) {
      const off = d < rangeEnd && !isWorkday(doc.calendar, d);
      if (off && runStart === null) runStart = d;
      if (!off && runStart !== null) {
        nonWorking.push({ x: x(runStart), w: (d - runStart) * pxPerDay });
        runStart = null;
      }
    }
  }

  // --- Dependencias ---
  const deps: DepLink[] = [];
  if (s.features.deps) {
    for (const r of rows) {
      if (!r.task) continue;
      for (const d of r.task.deps) {
        const from = rowByKey.get(d.key);
        if (!from) continue;
        deps.push({ key: `${d.key}->${r.key}`, from, to: r, critical: d.critical && r.task.critical, dimmed: from.dimmed || r.dimmed });
      }
    }
  }

  // --- Columnas ---
  const columns: ColumnDef[] = [{ key: 'name', ...COLUMN_DEFS.name }];
  for (const c of s.columns) columns.push({ key: c, ...COLUMN_DEFS[c] });
  const gridW = columns.reduce((a, c) => a + c.width, 0);

  return {
    rows, rowByKey, rowH, headerH, columns, gridW, rangeStart, rangeEnd, pxPerDay, width,
    height: rows.length * rowH,
    top, bottom, sprintTier, sprints, nonWorking, deps, today, matchCount, totalCount,
  };
}

function alignStart(scale: ViewSettings['scale'], d: Day): Day {
  switch (scale) {
    case 'day': return d - 2;
    case 'week':
    case 'sprint': return startOfWeek(d) - 7;
    case 'month': return startOfMonth(d - 7);
    case 'quarter': return startOfQuarter(d - 15);
    case 'year': return startOfYear(d - 30);
  }
}

function alignEnd(scale: ViewSettings['scale'], d: Day): Day {
  switch (scale) {
    case 'day': return d + 4;
    case 'week':
    case 'sprint': return startOfWeek(d) + 14;
    case 'month': return addMonths(startOfMonth(d), 2);
    case 'quarter': return addMonths(startOfQuarter(d), 6);
    case 'year': return fromYmd(ymd(d).y + 2, 0, 1);
  }
}

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Elige las unidades de las dos filas del eje según los píxeles por día (no solo la escala). */
export function tiersFor(scale: ViewSettings['scale'], px: number): { top: Unit | 'sprint' | 'quarterYear'; bottom: Unit } {
  if (scale === 'sprint') return { top: 'sprint', bottom: px >= 26 ? 'day' : 'week' };
  if (px >= 26) return { top: 'month', bottom: 'day' };
  if (px >= 7) return { top: 'month', bottom: 'week' };
  if (px >= 2.2) return { top: 'year', bottom: 'month' };
  if (px >= 1.1) return { top: 'quarterYear', bottom: 'month' };
  if (px >= 0.3) return { top: 'year', bottom: 'quarter' };
  return { top: 'year', bottom: 'year' };
}

function buildTicks(scale: ViewSettings['scale'], start: Day, end: Day, x: (d: Day) => number, px: number, sprintTicks: Tick[]) {
  const span = (key: string, a0: Day, b0: Day, label: string, strong = false): Tick => {
    const a = Math.max(a0, start), b = Math.min(b0, end);
    return { key, x: x(a), w: (b - a) * px, label, start: a0, end: b0, strong };
  };
  const qLabel = (d: Day) => `T${Math.floor(ymd(d).m / 3) + 1}`;

  const gen = (unit: Unit | 'quarterYear', long: boolean): Tick[] => {
    const out: Tick[] = [];
    switch (unit) {
      case 'day':
        for (let d = start; d < end; d++) out.push(span(`d${d}`, d, d + 1, `${weekdayLetter(d)} ${ymd(d).d}`, ymd(d).d === 1));
        break;
      case 'week':
        for (let d = startOfWeek(start); d < end; d += 7) out.push(span(`w${d}`, d, d + 7, formatShort(d)));
        break;
      case 'month':
        for (let d = startOfMonth(start); d < end; d = addMonths(d, 1)) {
          const { y, m } = ymd(d);
          out.push(span(`m${d}`, d, addMonths(d, 1), long ? `${monthLong(m)} ${y}` : monthShort(m), m === 0));
        }
        break;
      case 'quarter':
      case 'quarterYear':
        for (let d = startOfQuarter(start); d < end; d = addMonths(d, 3)) {
          out.push(span(`q${d}`, d, addMonths(d, 3), unit === 'quarterYear' ? `${qLabel(d)} ${ymd(d).y}` : qLabel(d), ymd(d).m === 0));
        }
        break;
      case 'year':
        for (let d = startOfYear(start); d < end; d = fromYmd(ymd(d).y + 1, 0, 1)) {
          out.push(span(`y${d}`, d, fromYmd(ymd(d).y + 1, 0, 1), String(ymd(d).y), true));
        }
        break;
    }
    return out;
  };

  const t = tiersFor(scale, px);
  const top = t.top === 'sprint' ? sprintTicks : gen(t.top, true);
  const bottom = gen(t.bottom, false);
  return { top, bottom };
}
