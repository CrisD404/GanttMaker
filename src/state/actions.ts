import { signal } from '@preact/signals';
import { toIso, type Day } from '../core/dates';
import { revealLine } from '../editor/Editor';
import { CRIT_TAG, STATUS_TAGS, type Column, type ColorBy, type Density, type Feature, type Scale, type Status, type TaskSpec } from '../core/types';
import {
  addSection as wAddSection, addView, deleteTask as wDeleteTask, deleteView as wDeleteView, insertTask,
  renameView as wRenameView, retimeTask, setFeature as wSetFeature, setSetting, setSprintCadence, uniqueName, updateTask,
  type InsertWhere,
} from '../core/writer';
import { EMPTY_QUICK, quickActive } from '../render/layout';
import {
  activeView, collapsed, currentView, doc, edit, getEditor, inspectorOpen, quickFilter, selectedKey, settings, source, toast, toastUndo,
  undo,
} from './store';

/** Tarea cuyo nombre se está editando: en la grilla o directamente sobre la barra. */
export const renaming = signal<{ key: string; where: 'grid' | 'chart' } | null>(null);

export function startRename(key: string, where: 'grid' | 'chart' = 'grid') {
  renaming.value = { key, where };
}

export function selectTask(key: string | null, opts: { reveal?: boolean; open?: boolean } = {}) {
  selectedKey.value = key;
  if (!key) {
    inspectorOpen.value = false;
    return;
  }
  if (opts.open) inspectorOpen.value = true;
  if (opts.reveal !== false) {
    const t = doc.value.tasks.find((x) => x.key === key);
    const ed = getEditor();
    if (t && ed) revealLine(ed, t.line);
  }
}

/** Lleva el cursor del editor a la tarea y le da foco. */
export function goToCode(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  const ed = getEditor();
  if (!t || !ed) return;
  revealLine(ed, t.line);
  ed.focus();
}

function findByName(name: string) {
  return doc.value.tasks.find((t) => t.spec.name === name);
}

function newSpec(name: string, extra: Partial<TaskSpec> = {}): TaskSpec {
  return { name, owners: [], tags: [], after: [], milestone: false, duration: { n: 3, unit: 'd' }, ...extra };
}

function insertAndSelect(where: InsertWhere, spec: TaskSpec, rename: 'grid' | 'chart' | false = 'grid') {
  edit((text, d) => insertTask(text, d, where, spec));
  const t = findByName(spec.name);
  if (t) {
    selectTask(t.key);
    if (rename) startRename(t.key, rename);
  }
}

function expand(key: string) {
  if (!collapsed.value.has(key)) return;
  const c = new Set(collapsed.value);
  c.delete(key);
  collapsed.value = c;
}

export function addTaskAfter(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  insertAndSelect({ kind: 'after', key }, newSpec(uniqueName(doc.value, 'Nueva tarea'), { owners: t ? [...t.spec.owners] : [] }));
}

export function addSubtask(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  expand(key);
  insertAndSelect({ kind: 'child', key }, newSpec(uniqueName(doc.value, 'Subtarea'), { owners: t ? [...t.spec.owners] : [] }));
}

export function addTaskToSection(sectionKey: string) {
  expand(sectionKey);
  insertAndSelect({ kind: 'section', sectionKey }, newSpec(uniqueName(doc.value, 'Nueva tarea')));
}

export function addMilestoneAfter(key: string) {
  insertAndSelect({ kind: 'after', key }, newSpec(uniqueName(doc.value, 'Hito'), { milestone: true, duration: undefined }));
}

/**
 * Crea una tarea (o hito) que empieza en `day`, junto a la fila indicada.
 * Es la acción del doble clic sobre un espacio vacío del gráfico.
 */
export function createTaskAt(day: Day, near: { kind: 'task' | 'section'; key: string } | null, milestone = false) {
  const d = doc.value;
  const name = uniqueName(d, milestone ? 'Hito' : 'Nueva tarea');
  const spec = newSpec(name, milestone ? { milestone: true, duration: undefined, start: toIso(day) } : { start: toIso(day) });
  let where: InsertWhere | null = null;
  if (near?.kind === 'task') {
    const t = d.tasks.find((x) => x.key === near.key);
    if (t) {
      spec.owners = [...t.spec.owners];
      where = { kind: 'after', key: t.key };
    }
  } else if (near?.kind === 'section') {
    expand(near.key);
    where = { kind: 'section', sectionKey: near.key };
  }
  if (!where) {
    const last = d.sections[d.sections.length - 1];
    if (!last) {
      edit((text, doc) => wAddSection(text, doc, 'Nueva sección', name));
      const t = findByName(name);
      if (t) {
        selectTask(t.key);
        startRename(t.key, 'chart');
      }
      return;
    }
    where = { kind: 'section', sectionKey: last.key };
  }
  insertAndSelect(where, spec, 'chart');
}

export function addSection() {
  const used = new Set(doc.value.sections.map((s) => s.name.toLowerCase()));
  let name = 'Nueva sección';
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `Nueva sección ${i}`;
  const taskName = uniqueName(doc.value, 'Nueva tarea');
  edit((text, d) => wAddSection(text, d, name, taskName));
  const t = findByName(taskName);
  if (t) selectTask(t.key);
}

export function duplicateTask(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  if (!t) return;
  const name = uniqueName(doc.value, `${t.spec.name} (copia)`);
  insertAndSelect({ kind: 'after', key }, { ...t.spec, id: undefined, name, after: [...t.spec.after] }, false);
}

export function deleteTask(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  if (!t) return;
  edit((text, d) => wDeleteTask(text, d, key));
  if (selectedKey.value === key) selectTask(null);
  toastUndo(`"${t.spec.name}" eliminada`);
}

export function patchTask(key: string, patch: Partial<TaskSpec>) {
  edit((text, d) => updateTask(text, d, key, patch));
}

export function setStatus(key: string, status: Status | null) {
  const t = doc.value.tasks.find((x) => x.key === key);
  if (!t) return;
  const tags = t.spec.tags.filter((x) => !(STATUS_TAGS as readonly string[]).includes(x));
  if (status) tags.unshift(status);
  const patch: Partial<TaskSpec> = { tags };
  if (status === 'done' && !t.spec.milestone) patch.progress = 100;
  else if (t.spec.progress === 100 && status !== 'done') patch.progress = undefined;
  patchTask(key, patch);
}

export function toggleCritical(key: string) {
  const t = doc.value.tasks.find((x) => x.key === key);
  if (!t) return;
  const tags = t.spec.tags.includes(CRIT_TAG) ? t.spec.tags.filter((x) => x !== CRIT_TAG) : [...t.spec.tags, CRIT_TAG];
  patchTask(key, { tags });
}

export function nudgeTask(key: string, days: number) {
  const t = doc.value.tasks.find((x) => x.key === key);
  if (!t || t.children.length) return;
  edit((text, d) => retimeTask(text, d, key, t.start + days, t.end + days, 'move'));
}

export function toggleCollapse(key: string) {
  const c = new Set(collapsed.value);
  if (c.has(key)) c.delete(key);
  else c.add(key);
  collapsed.value = c;
}

// --- Ajustes de la vista activa ---------------------------------------------

export function setScale(s: Scale) {
  edit((text, d) => setSetting(text, d, currentView.value, 'scale', s));
}
export function setDetail(n: number) {
  const name = n >= 99 ? 'all' : n === 1 ? 'sections' : n === 2 ? 'tasks' : n === 3 ? 'subtasks' : String(n);
  collapsed.value = new Set();
  edit((text, d) => setSetting(text, d, currentView.value, 'detail', name));
}
export function setDensity(v: Density) {
  edit((text, d) => setSetting(text, d, currentView.value, 'density', v));
}
export function setColorBy(v: ColorBy) {
  edit((text, d) => setSetting(text, d, currentView.value, 'color', v));
}
export function setColumns(cols: Column[]) {
  edit((text, d) => setSetting(text, d, currentView.value, 'columns', cols.length ? cols.join(', ') : 'none'));
}
export function toggleColumn(c: Column, on: boolean) {
  const cur = settings.value.columns;
  const order: Column[] = ['owner', 'start', 'end', 'duration', 'progress'];
  setColumns(on ? order.filter((x) => x === c || cur.includes(x)) : cur.filter((x) => x !== c));
}
export function setFeatureVisible(f: Feature, visible: boolean) {
  edit((text, d) => wSetFeature(text, d, currentView.value, f, visible));
}

function filterValue(owners: string[], tags: string[], text: string): string | null {
  const parts = [
    ...owners.map((o) => (/\s/.test(o) ? `@"${o}"` : `@${o}`)),
    ...tags.map((t) => `#${t}`),
    ...(text.trim() ? [`"${text.trim().replace(/"/g, "'")}"`] : []),
  ];
  return parts.length ? parts.join(' ') : null;
}

/** Filtro guardado en el código de la vista activa. */
export function setViewFilter(owners: string[], tags: string[], text = '') {
  edit((d0, d) => setSetting(d0, d, currentView.value, 'filter', filterValue(owners, tags, text)));
}

// --- Filtro rápido (dock) ----------------------------------------------------

export function toggleQuickOwner(name: string) {
  const q = quickFilter.value;
  const has = q.owners.some((o) => o.toLowerCase() === name.toLowerCase());
  quickFilter.value = { ...q, owners: has ? q.owners.filter((o) => o.toLowerCase() !== name.toLowerCase()) : [...q.owners, name] };
}
export function toggleQuickTag(tag: string) {
  const q = quickFilter.value;
  quickFilter.value = { ...q, tags: q.tags.includes(tag) ? q.tags.filter((t) => t !== tag) : [...q.tags, tag] };
}
export function clearQuickFilter() {
  quickFilter.value = { ...EMPTY_QUICK, mode: quickFilter.value.mode };
}
/** Pasa el filtro rápido al código de la vista activa (y lo limpia del dock). */
export function saveQuickFilterToView() {
  const q = quickFilter.value;
  if (!quickActive(q)) return;
  const s = settings.value;
  setViewFilter(q.owners.length ? q.owners : s.filterOwners, q.tags.length ? q.tags : s.filterTags, q.text.trim() || s.filterText);
  clearQuickFilter();
  toast(`Filtro guardado en la vista ${currentView.value ?? 'Principal'}`, 'success', { label: 'Deshacer', run: undo });
}

// --- Sprints -------------------------------------------------------------------

export function setSprints(value: string | null) {
  edit((text, d) => setSprintCadence(text, d, value));
}

// --- Vistas ------------------------------------------------------------------

export function createView(from: string | null = null) {
  const used = new Set(doc.value.views.map((v) => v.name.toLowerCase()));
  let name = 'Nueva vista';
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `Nueva vista ${i}`;
  // Duplicar: copiar las líneas de ajustes de la vista origen
  const src = from ? doc.value.views.find((v) => v.name === from) : undefined;
  const lines = source.value.split('\n');
  const body = src
    ? Object.values(src.settingLines).filter((l): l is number => l !== undefined).sort((a, b) => a - b).map((l) => lines[l].trim())
    : ['detail tasks'];
  edit((text, d) => addView(text, d, name, body.length ? body : ['detail tasks']));
  activeView.value = name;
  toast(`Vista "${name}" creada: sus ajustes viven en el bloque "view"`, 'success');
  return name;
}

export function renameView(oldName: string, name: string) {
  const clean = name.trim();
  if (!clean || clean === oldName) return;
  if (doc.value.views.some((v) => v.name.toLowerCase() === clean.toLowerCase())) {
    toast('Ya existe una vista con ese nombre', 'error');
    return;
  }
  edit((text, d) => wRenameView(text, d, oldName, clean));
  if (activeView.value === oldName) activeView.value = clean;
}

export function deleteView(name: string) {
  edit((text, d) => wDeleteView(text, d, name));
  if (activeView.value === name) activeView.value = null;
  toastUndo(`Vista "${name}" eliminada`);
}
