// Ediciones de texto generadas desde la UI. Cada operación recibe el texto actual y el
// documento parseado de ese mismo texto, y devuelve el texto nuevo. Solo se tocan las
// líneas necesarias, para que el diff sea legible y el deshacer funcione línea a línea.

import { countWorkdays, toIso, workdaysPerWeek, type Day } from './dates';
import { quoteIfNeeded } from './lexer';
import { parse } from './parser';
import { findTask, refOf } from './schedule';
import {
  FEATURES, type Feature, type GanttDoc, type SectionNode, type SettingKey, type TaskNode, type TaskSpec,
} from './types';
import { baseSettings } from './views';

const INDENT = '  ';

function quoteOwner(name: string): string {
  return /\s/.test(name) ? `@"${name}"` : `@${name}`;
}

export function serializeTask(spec: TaskSpec): string {
  const parts: string[] = [quoteIfNeeded(spec.name)];
  if (spec.id) parts.push(`id:${spec.id}`);
  for (const o of spec.owners) parts.push(quoteOwner(o));
  if (spec.start && spec.end && !spec.milestone) parts.push(`${spec.start}..${spec.end}`);
  else if (spec.start) parts.push(spec.start);
  if (spec.milestone) parts.push('milestone');
  else if (spec.duration && !spec.end) parts.push(`${spec.duration.n}${spec.duration.unit}`);
  if (spec.after.length) parts.push('after ' + spec.after.map((r) => (r.includes(',') ? `"${r}"` : r)).join(', '));
  if (spec.progress !== undefined && !spec.milestone) parts.push(`${spec.progress}%`);
  for (const t of spec.tags) parts.push(`#${t}`);
  if (spec.color) parts.push(spec.color);
  return parts.join(' ');
}

function lines(text: string): string[] {
  return text.split('\n');
}

function taskLine(t: TaskNode, spec: TaskSpec): string {
  return t.indent + serializeTask(spec) + (t.comment ? ' ' + t.comment : '');
}

/** Última línea del subárbol de la tarea (ella + descendientes). */
function subtreeEnd(t: TaskNode): number {
  let end = t.line;
  for (const c of t.children) end = Math.max(end, subtreeEnd(c));
  return end;
}

function sectionEnd(s: SectionNode): number {
  let end = s.line;
  for (const t of s.tasks) end = Math.max(end, subtreeEnd(t));
  return end;
}

function byKey(doc: GanttDoc, key: string): TaskNode {
  const t = doc.tasks.find((x) => x.key === key);
  if (!t) throw new Error(`Tarea no encontrada: ${key}`);
  return t;
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export function updateTask(text: string, doc: GanttDoc, key: string, patch: Partial<TaskSpec>): string {
  const t = byKey(doc, key);
  const ls = lines(text);
  const spec: TaskSpec = { ...t.spec, ...patch };
  ls[t.line] = taskLine(t, spec);

  // Si cambió el nombre, actualizar las referencias `after` que lo usaban
  if (patch.name !== undefined && patch.name !== t.spec.name && !t.spec.id) {
    const old = t.spec.name.toLowerCase();
    for (const other of doc.tasks) {
      if (other === t) continue;
      const idx = other.spec.after.findIndex((r) => r.toLowerCase() === old);
      if (idx >= 0) {
        const after = [...other.spec.after];
        after[idx] = patch.name;
        ls[other.line] = taskLine(other, { ...other.spec, after });
      }
    }
  }
  return ls.join('\n');
}

/** Mueve/redimensiona una tarea a nuevas fechas (fin exclusivo), conservando su forma de escritura. */
export function retimeTask(
  text: string,
  doc: GanttDoc,
  key: string,
  newStart: Day,
  newEnd: Day,
  mode: 'move' | 'resize-start' | 'resize-end',
): string {
  const t = byKey(doc, key);
  const s = t.spec;
  const patch: Partial<TaskSpec> = {};
  const depEnd = t.deps.length ? Math.max(...t.deps.map((d) => d.end)) : null;

  if (s.milestone) {
    patch.start = depEnd !== null && newStart === depEnd ? undefined : toIso(newStart);
    return updateTask(text, doc, key, patch);
  }

  if (mode !== 'resize-end') {
    // Si quedó justo donde la dependencia lo dejaría, no hace falta una fecha explícita.
    const auto = depEnd !== null && newStart <= depEnd && !s.end;
    patch.start = auto ? undefined : toIso(newStart);
  }
  if (s.end) {
    patch.end = toIso(Math.max(newStart, newEnd - 1));
    if (!patch.start && mode !== 'resize-end') patch.start = toIso(newStart);
  } else if (mode !== 'move') {
    const n = Math.max(1, countWorkdays(doc.calendar, newStart, newEnd));
    const wpw = workdaysPerWeek(doc.calendar);
    patch.duration = s.duration?.unit === 'w' && n % wpw === 0 ? { n: n / wpw, unit: 'w' } : { n, unit: 'd' };
  }
  return updateTask(text, doc, key, patch);
}

export function deleteTask(text: string, doc: GanttDoc, key: string): string {
  const t = byKey(doc, key);
  const removed = new Set<TaskNode>();
  const collect = (x: TaskNode) => {
    removed.add(x);
    x.children.forEach(collect);
  };
  collect(t);
  const ls = lines(text);
  // Quitar referencias en otras tareas
  for (const other of doc.tasks) {
    if (removed.has(other)) continue;
    const after = other.spec.after.filter((r) => {
      const target = findTask(doc, r);
      return !target || !removed.has(target);
    });
    if (after.length !== other.spec.after.length) ls[other.line] = taskLine(other, { ...other.spec, after });
  }
  ls.splice(t.line, subtreeEnd(t) - t.line + 1);
  return ls.join('\n');
}

export type InsertWhere =
  | { kind: 'after'; key: string }
  | { kind: 'child'; key: string }
  | { kind: 'section'; sectionKey: string };

export function insertTask(text: string, doc: GanttDoc, where: InsertWhere, spec: TaskSpec): string {
  const ls = lines(text);
  let at: number;
  let indent: string;
  if (where.kind === 'after') {
    const t = byKey(doc, where.key);
    at = subtreeEnd(t) + 1;
    indent = t.indent;
  } else if (where.kind === 'child') {
    const t = byKey(doc, where.key);
    at = subtreeEnd(t) + 1;
    indent = (t.children[0]?.indent ?? t.indent + INDENT);
  } else {
    const s = doc.sections.find((x) => x.key === where.sectionKey);
    if (!s) throw new Error('Sección no encontrada');
    at = sectionEnd(s) + 1;
    indent = s.tasks[0]?.indent ?? (s.line >= 0 ? INDENT : '');
    if (s.line < 0 && !s.tasks.length) at = Math.max(at, doc.headerEnd + 1);
  }
  ls.splice(at, 0, indent + serializeTask(spec));
  return ls.join('\n');
}

/** Nombre libre: "Nueva tarea", "Nueva tarea 2", … */
export function uniqueName(doc: GanttDoc, base: string): string {
  const names = new Set(doc.tasks.map((t) => t.spec.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export type MovePosition = 'before' | 'after' | 'inside';

/** Mueve el bloque de líneas de una tarea (con sus subtareas) a otra posición. */
export function moveTask(text: string, doc: GanttDoc, key: string, targetKey: string, pos: MovePosition): string {
  const t = byKey(doc, key);
  const target = byKey(doc, targetKey);
  if (t === target) return text;
  for (let p = target.parent; p; p = p.parent) if (p === t) return text; // no dentro de sí misma

  const ls = lines(text);
  const start = t.line;
  const end = subtreeEnd(t);
  const block = ls.slice(start, end + 1);

  const newIndent = pos === 'inside' ? (target.children[0]?.indent ?? target.indent + INDENT) : target.indent;
  const reindented = block.map((l) => (l.startsWith(t.indent) ? newIndent + l.slice(t.indent.length) : l));

  let at = pos === 'before' ? target.line : subtreeEnd(target) + 1;
  ls.splice(start, block.length);
  if (at > start) at -= block.length;
  ls.splice(at, 0, ...reindented);
  return ls.join('\n');
}

/** Mueve una tarea al final de una sección. */
export function moveTaskToSection(text: string, doc: GanttDoc, key: string, sectionKey: string): string {
  const t = byKey(doc, key);
  const s = doc.sections.find((x) => x.key === sectionKey);
  if (!s) return text;
  const ls = lines(text);
  const start = t.line;
  const end = subtreeEnd(t);
  const block = ls.slice(start, end + 1);
  const newIndent = s.tasks.find((x) => x !== t)?.indent ?? (s.line >= 0 ? INDENT : '');
  const reindented = block.map((l) => (l.startsWith(t.indent) ? newIndent + l.slice(t.indent.length) : l));
  let at = sectionEnd(s) + 1;
  if (at > start && at <= end + 1) return text;
  ls.splice(start, block.length);
  if (at > start) at -= block.length;
  ls.splice(at, 0, ...reindented);
  return ls.join('\n');
}

/** Agrega `from` como dependencia de `to`. */
export function addDependency(text: string, doc: GanttDoc, fromKey: string, toKey: string): string {
  const from = byKey(doc, fromKey);
  const to = byKey(doc, toKey);
  if (to.deps.includes(from)) return text;
  return updateTask(text, doc, toKey, { after: [...to.spec.after, refOf(from)] });
}

export function removeDependency(text: string, doc: GanttDoc, fromKey: string, toKey: string): string {
  const from = byKey(doc, fromKey);
  const to = byKey(doc, toKey);
  const after = to.spec.after.filter((r) => findTask(doc, r) !== from);
  return updateTask(text, doc, toKey, { after });
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

export function addSection(text: string, doc: GanttDoc, name: string, firstTask: string): string {
  const ls = lines(text);
  let at = doc.headerEnd + 1;
  for (const s of doc.sections) at = Math.max(at, sectionEnd(s) + 1);
  for (const t of doc.tasks) at = Math.max(at, subtreeEnd(t) + 1);
  // Línea en blanco de separación para que sea legible
  const block = [`section ${name}`, `${INDENT}${quoteIfNeeded(firstTask)} 3d`];
  if (at > 0 && ls[at - 1]?.trim()) block.unshift('');
  ls.splice(at, 0, ...block);
  return ls.join('\n');
}

export function renameSection(text: string, doc: GanttDoc, sectionKey: string, name: string): string {
  const s = doc.sections.find((x) => x.key === sectionKey);
  if (!s || s.line < 0) return text;
  const ls = lines(text);
  // Conservar el color explícito si la línea original lo tenía
  const color = /\s(#[0-9a-f]{3}(?:[0-9a-f]{3})?)(?=\s|$)/i.exec(ls[s.line])?.[1];
  ls[s.line] = `section ${name}${color ? ' ' + color : ''}`;
  return ls.join('\n');
}

export function deleteSection(text: string, doc: GanttDoc, sectionKey: string): string {
  const s = doc.sections.find((x) => x.key === sectionKey);
  if (!s || s.line < 0) return text;
  const ls = lines(text);
  ls.splice(s.line, sectionEnd(s) - s.line + 1);
  return ls.join('\n');
}

// ---------------------------------------------------------------------------
// Responsables
// ---------------------------------------------------------------------------

export function addOwner(text: string, doc: GanttDoc, kind: 'team' | 'person', name: string, color: string, team?: string): string {
  const ls = lines(text);
  let at = doc.headerEnd + 1;
  for (const o of doc.owners.values()) if (o.line >= 0) at = Math.max(at, o.line + 1);
  const parts = [kind, /\s/.test(name) ? `"${name}"` : name];
  if (team) parts.push(/\s/.test(team) ? `@"${team}"` : `@${team}`);
  parts.push(color);
  ls.splice(at, 0, parts.join(' '));
  return ls.join('\n');
}

// ---------------------------------------------------------------------------
// Ajustes y vistas
// ---------------------------------------------------------------------------

/** Escribe (o borra con `value = null`) un ajuste en la vista dada o en el nivel superior. */
export function setSetting(text: string, doc: GanttDoc, viewName: string | null, key: SettingKey, value: string | null): string {
  const ls = lines(text);
  const view = viewName ? doc.views.find((v) => v.name === viewName) : undefined;
  const settingLines = view ? view.settingLines : doc.baseSettingLines;
  const existing = settingLines[key];

  if (existing !== undefined) {
    if (value === null) ls.splice(existing, 1);
    else {
      const indent = /^\s*/.exec(ls[existing])![0];
      ls[existing] = `${indent}${key} ${value}`;
    }
    return ls.join('\n');
  }
  if (value === null) return text;

  if (view) {
    ls.splice(view.endLine + 1, 0, `${INDENT}${key} ${value}`);
  } else {
    let at = doc.headerEnd;
    for (const l of Object.values(doc.baseSettingLines)) if (l !== undefined && l <= firstContentLine(doc)) at = Math.max(at, l);
    ls.splice(at + 1, 0, `${key} ${value}`);
  }
  return ls.join('\n');
}

function firstContentLine(doc: GanttDoc): number {
  const candidates = [
    ...doc.sections.map((s) => s.line).filter((l) => l >= 0),
    ...doc.tasks.map((t) => t.line),
    ...doc.views.map((v) => v.line),
    ...[...doc.owners.values()].map((o) => o.line).filter((l) => l >= 0),
  ];
  return candidates.length ? Math.min(...candidates) : Infinity;
}

/** Muestra u oculta un elemento visual, reescribiendo las líneas `show` / `hide` del bloque. */
export function setFeature(text: string, doc: GanttDoc, viewName: string | null, feature: Feature, visible: boolean): string {
  const view = viewName ? doc.views.find((v) => v.name === viewName) : undefined;
  const o = view ? view.overrides : doc.base;
  const parentValue = view ? baseSettings(doc).features[feature] : true;

  const show = new Set(o.show ?? []);
  const hide = new Set(o.hide ?? []);
  show.delete(feature);
  hide.delete(feature);
  if (visible !== parentValue) (visible ? show : hide).add(feature);

  const fmt = (s: Set<Feature>) => (s.size ? FEATURES.filter((f) => s.has(f)).join(', ') : null);
  // Primero el que está más abajo para no desplazar los números de línea del otro.
  const lineOf = (k: SettingKey) => (view ? view.settingLines[k] : doc.baseSettingLines[k]) ?? -1;
  const order: SettingKey[] = lineOf('show') > lineOf('hide') ? ['show', 'hide'] : ['hide', 'show'];
  let out = text;
  let current = doc;
  for (const k of order) {
    const val = fmt(k === 'show' ? show : hide);
    out = setSetting(out, current, viewName, k, val);
    current = parse(out); // los números de línea cambian entre ediciones encadenadas
  }
  return out;
}

export function addView(text: string, _doc: GanttDoc, name: string, body: string[]): string {
  const ls = lines(text);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  ls.push('', `view ${name}`, ...body.map((b) => INDENT + b));
  return ls.join('\n') + '\n';
}

export function renameView(text: string, doc: GanttDoc, oldName: string, name: string): string {
  const v = doc.views.find((x) => x.name === oldName);
  if (!v) return text;
  const ls = lines(text);
  ls[v.line] = `view ${name}`;
  return ls.join('\n');
}

export function deleteView(text: string, doc: GanttDoc, name: string): string {
  const v = doc.views.find((x) => x.name === name);
  if (!v) return text;
  const ls = lines(text);
  let start = v.line;
  if (start > 0 && !ls[start - 1].trim()) start--; // línea en blanco previa
  ls.splice(start, v.endLine - start + 1);
  return ls.join('\n');
}

/** Escribe (o borra con `value = null`) la línea `sprints` de cadencia. */
export function setSprintCadence(text: string, doc: GanttDoc, value: string | null): string {
  const ls = lines(text);
  const line = doc.sprintCadence?.line;
  if (line !== undefined) {
    if (value === null) ls.splice(line, 1);
    else ls[line] = `sprints ${value}`;
    return ls.join('\n');
  }
  if (value === null) return text;
  let at = doc.headerEnd;
  for (const l of Object.values(doc.baseSettingLines)) if (l !== undefined && l <= firstContentLine(doc)) at = Math.max(at, l);
  ls.splice(at + 1, 0, `sprints ${value}`);
  return ls.join('\n');
}

export function setTitle(text: string, doc: GanttDoc, title: string): string {
  const ls = lines(text);
  const line = `gantt ${/\s/.test(title) || !title ? `"${title}"` : title}`;
  if (doc.titleLine >= 0) ls[doc.titleLine] = line;
  else ls.unshift(line);
  return ls.join('\n');
}
