import type { Calendar, Day } from './dates';

export type Scale = 'day' | 'week' | 'sprint' | 'month' | 'quarter' | 'year';
export const SCALES: Scale[] = ['day', 'week', 'sprint', 'month', 'quarter', 'year'];

export type Density = 'compact' | 'normal' | 'comfortable';
export const DENSITIES: Density[] = ['compact', 'normal', 'comfortable'];

export type Column = 'owner' | 'start' | 'end' | 'duration' | 'progress';
export const COLUMNS: Column[] = ['owner', 'start', 'end', 'duration', 'progress'];

/** Elementos visuales que se pueden mostrar u ocultar con `show` / `hide`. */
export type Feature = 'deps' | 'today' | 'weekends' | 'progress' | 'avatars' | 'labels' | 'grid' | 'sprints';
export const FEATURES: Feature[] = ['deps', 'today', 'weekends', 'progress', 'avatars', 'labels', 'grid', 'sprints'];

/** Estados reservados que se escriben como etiquetas (`#done`). */
export const STATUS_TAGS = ['done', 'active', 'blocked'] as const;
export type Status = (typeof STATUS_TAGS)[number];
export const CRIT_TAG = 'crit';

export interface Diagnostic {
  /** Línea (0-based) */
  line: number;
  /** Columnas dentro de la línea */
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface Duration {
  n: number;
  unit: 'd' | 'w';
}

/** Lo que el usuario escribió en la línea de la tarea. Es lo que se vuelve a serializar. */
export interface TaskSpec {
  name: string;
  id?: string;
  owners: string[];
  tags: string[];
  color?: string;
  start?: string;
  end?: string;
  duration?: Duration;
  after: string[];
  progress?: number;
  milestone: boolean;
}

export interface TaskNode {
  /** Clave estable (independiente del número de línea) para animaciones y selección. */
  key: string;
  spec: TaskSpec;
  line: number;
  indent: string;
  comment: string;
  depth: number;
  parent: TaskNode | null;
  children: TaskNode[];
  section: SectionNode;
  // --- calculados por el scheduler ---
  start: Day;
  /** Fin exclusivo. En hitos start === end. */
  end: Day;
  deps: TaskNode[];
  status: Status | null;
  critical: boolean;
}

export interface SectionNode {
  key: string;
  name: string;
  /** -1 para la sección implícita (tareas antes de cualquier `section`). */
  line: number;
  color?: string;
  tasks: TaskNode[];
  start: Day;
  end: Day;
}

export interface Owner {
  name: string;
  kind: 'team' | 'person';
  color: string;
  team?: string;
  line: number;
}

/** Criterio de color de las barras. */
export type ColorBy = 'owner' | 'section' | 'status';
export const COLOR_BYS: ColorBy[] = ['owner', 'section', 'status'];

export interface ViewOverrides {
  scale?: Scale;
  colorBy?: ColorBy;
  detail?: number;
  columns?: Column[];
  show?: Feature[];
  hide?: Feature[];
  density?: Density;
  filter?: { owners: string[]; tags: string[]; text: string };
  range?: [Day, Day];
}

/** Sprint concreto (fin exclusivo). */
export interface Sprint {
  name: string;
  start: Day;
  end: Day;
  /** Línea donde se declaró (-1 si se generó por cadencia). */
  line: number;
}

/** Cadencia de sprints: `sprints 2w from 2026-10-05 "Sprint {n}" first 14`. */
export interface SprintCadence {
  /** Duración en días corridos. */
  length: number;
  /** Texto original de la duración ("2w"). */
  lengthText: string;
  from: Day | null;
  pattern: string;
  first: number;
  line: number;
}

export type SettingKey = 'scale' | 'detail' | 'columns' | 'show' | 'hide' | 'density' | 'filter' | 'range' | 'color';
export const SETTING_KEYS: SettingKey[] = ['scale', 'detail', 'columns', 'show', 'hide', 'density', 'filter', 'range', 'color'];

export interface ViewDef {
  name: string;
  line: number;
  /** Última línea del bloque (inclusive). */
  endLine: number;
  overrides: ViewOverrides;
  settingLines: Partial<Record<SettingKey, number>>;
}

export interface ViewSettings {
  scale: Scale;
  colorBy: ColorBy;
  detail: number;
  columns: Column[];
  features: Record<Feature, boolean>;
  density: Density;
  filterOwners: string[];
  filterTags: string[];
  filterText: string;
  range: [Day, Day] | null;
}

export interface GanttDoc {
  title: string;
  titleLine: number;
  projectStart: Day | null;
  startLine: number;
  today: Day | null;
  /** Inicio efectivo del proyecto (lo calcula el scheduler). */
  anchor: Day;
  calendar: Calendar;
  sprintCadence: SprintCadence | null;
  sprintList: Sprint[];
  owners: Map<string, Owner>;
  sections: SectionNode[];
  tasks: TaskNode[];
  views: ViewDef[];
  /** Ajustes de nivel superior (la vista principal). */
  base: ViewOverrides;
  baseSettingLines: Partial<Record<SettingKey, number>>;
  /** Última línea del encabezado (antes de team/person/section/view); para insertar ajustes. */
  headerEnd: number;
  diagnostics: Diagnostic[];
  lineCount: number;
}
