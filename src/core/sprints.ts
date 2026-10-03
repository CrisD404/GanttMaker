import { startOfWeek, type Day } from './dates';
import type { GanttDoc, Sprint, SprintCadence } from './types';

/** Cadencia por defecto cuando se pide la escala "sprint" sin declarar sprints. */
export function defaultCadence(): SprintCadence {
  return { length: 14, lengthText: '2w', from: null, pattern: 'Sprint {n}', first: 1, line: -1 };
}

export function hasSprints(doc: GanttDoc): boolean {
  return !!doc.sprintCadence || doc.sprintList.length > 0;
}

export function sprintName(pattern: string, n: number): string {
  return pattern.includes('{n}') ? pattern.replace(/\{n\}/g, String(n)) : `${pattern} ${n}`;
}

/** Primer día de la cadencia: `from`, o el lunes de la semana de inicio del proyecto. */
export function cadenceAnchor(doc: GanttDoc, c: SprintCadence): Day {
  return c.from ?? startOfWeek(doc.anchor);
}

/**
 * Sprints que se superponen con [from, to).
 * Si hay sprints explícitos (`sprint ...`) se usan solo esos; si no, se generan por cadencia.
 */
export function sprintsInRange(doc: GanttDoc, from: Day, to: Day, fallback = false): Sprint[] {
  if (doc.sprintList.length) return doc.sprintList.filter((s) => s.end > from && s.start < to);
  const c = doc.sprintCadence ?? (fallback ? defaultCadence() : null);
  if (!c) return [];
  const anchor = cadenceAnchor(doc, c);
  const out: Sprint[] = [];
  let i = Math.max(0, Math.floor((from - anchor) / c.length));
  for (; anchor + i * c.length < to && out.length < 2000; i++) {
    const start = anchor + i * c.length;
    out.push({ name: sprintName(c.pattern, c.first + i), start, end: start + c.length, line: c.line });
  }
  return out;
}

/** Serializa una cadencia como línea `sprints`. */
export function serializeCadence(c: { lengthText: string; from: string | null; pattern: string; first: number }): string {
  const parts = [c.lengthText];
  if (c.from) parts.push(`from ${c.from}`);
  if (c.pattern && c.pattern !== 'Sprint {n}') parts.push(`"${c.pattern.replace(/"/g, "'")}"`);
  if (c.first !== 1) parts.push(`first ${c.first}`);
  return parts.join(' ');
}
