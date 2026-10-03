import { FEATURES, type Feature, type GanttDoc, type Scale, type ViewOverrides, type ViewSettings } from './types';

export const DEFAULT_COLUMNS: ViewSettings['columns'] = ['owner', 'duration'];

/** Escala automática según la duración total del proyecto. */
export function autoScale(doc: GanttDoc): Scale {
  if (!doc.tasks.length) return 'week';
  const start = Math.min(...doc.tasks.map((t) => t.start));
  const end = Math.max(...doc.tasks.map((t) => t.end));
  const span = end - start;
  if (span <= 21) return 'day';
  if (doc.sprintCadence || doc.sprintList.length) return 'sprint';
  if (span <= 120) return 'week';
  if (span <= 540) return 'month';
  if (span <= 1500) return 'quarter';
  return 'year';
}

function applyOverrides(s: ViewSettings, o: ViewOverrides) {
  if (o.scale) s.scale = o.scale;
  if (o.colorBy) s.colorBy = o.colorBy;
  if (o.detail !== undefined) s.detail = o.detail;
  if (o.columns) s.columns = [...o.columns];
  if (o.density) s.density = o.density;
  if (o.filter) {
    s.filterOwners = [...o.filter.owners];
    s.filterTags = [...o.filter.tags];
    s.filterText = o.filter.text;
  }
  if (o.range) s.range = o.range;
  for (const f of o.show ?? []) s.features[f] = true;
  for (const f of o.hide ?? []) s.features[f] = false;
}

export function baseSettings(doc: GanttDoc): ViewSettings {
  const features = Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>;
  const s: ViewSettings = {
    scale: autoScale(doc),
    colorBy: doc.owners.size ? 'owner' : 'section',
    detail: 99,
    columns: [...DEFAULT_COLUMNS],
    features,
    density: 'normal',
    filterOwners: [],
    filterTags: [],
    filterText: '',
    range: null,
  };
  applyOverrides(s, doc.base);
  return s;
}

/** Ajustes efectivos de una vista: valores por defecto ← nivel superior ← vista. */
export function resolveView(doc: GanttDoc, viewName: string | null): ViewSettings {
  const s = baseSettings(doc);
  const view = viewName ? doc.views.find((v) => v.name === viewName) : undefined;
  if (view) applyOverrides(s, view.overrides);
  return s;
}
