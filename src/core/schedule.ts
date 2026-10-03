import { addWorkdays, nextWorkday, parseIso, workdaysPerWeek, type Day } from './dates';
import { slugify } from './lexer';
import { PALETTE } from './parser';
import { CRIT_TAG, STATUS_TAGS, type GanttDoc, type Status, type TaskNode } from './types';

/** Busca una tarea por id, nombre exacto (sin distinguir mayúsculas) o slug. */
export function findTask(doc: GanttDoc, ref: string): TaskNode | undefined {
  const r = ref.trim().toLowerCase();
  return (
    doc.tasks.find((t) => t.spec.id?.toLowerCase() === r) ??
    doc.tasks.find((t) => t.spec.name.toLowerCase() === r) ??
    doc.tasks.find((t) => slugify(t.spec.name) === slugify(r))
  );
}

/** Referencia canónica para usar en `after`: el id si existe, si no el nombre. */
export function refOf(t: TaskNode): string {
  return t.spec.id ?? t.spec.name;
}

/**
 * Calcula fechas de inicio/fin de cada tarea, resuelve dependencias y responsables.
 * Muta el documento (los campos "calculados" de cada nodo).
 */
export function schedule(doc: GanttDoc, today: Day): GanttDoc {
  const diags = doc.diagnostics;
  const cal = doc.calendar;
  const wpw = workdaysPerWeek(cal);

  // Responsables no declarados → se crean como personas automáticamente
  const used = [...doc.owners.values()].map((o) => o.color);
  for (const t of doc.tasks) {
    for (const o of t.spec.owners) {
      const key = o.toLowerCase();
      if (!doc.owners.has(key)) {
        const color = PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
        used.push(color);
        doc.owners.set(key, { name: o, kind: 'person', color, line: -1 });
      }
    }
  }

  // Dependencias
  for (const t of doc.tasks) {
    t.deps = [];
    for (const ref of t.spec.after) {
      const dep = findTask(doc, ref);
      if (!dep) {
        diags.push({ line: t.line, from: 0, to: 9999, message: `No existe la tarea "${ref}" (usada en after)`, severity: 'error' });
      } else if (dep === t) {
        diags.push({ line: t.line, from: 0, to: 9999, message: 'Una tarea no puede depender de sí misma', severity: 'error' });
      } else if (isAncestor(dep, t) || isAncestor(t, dep)) {
        diags.push({ line: t.line, from: 0, to: 9999, message: `"${ref}" contiene o está contenida en esta tarea; no puede ser dependencia`, severity: 'error' });
      } else {
        t.deps.push(dep);
      }
    }
    const status = t.spec.tags.find((x) => (STATUS_TAGS as readonly string[]).includes(x)) as Status | undefined;
    t.status = status ?? (t.spec.progress === 100 ? 'done' : null);
    t.critical = t.spec.tags.includes(CRIT_TAG);
  }

  // Inicio del proyecto
  let projectStart = doc.projectStart;
  if (projectStart === null) {
    for (const t of doc.tasks) {
      const d = t.spec.start ? parseIso(t.spec.start) : null;
      if (d !== null && (projectStart === null || d < projectStart)) projectStart = d;
    }
  }
  const p0 = projectStart ?? today;
  doc.anchor = p0;

  const state = new Map<TaskNode, 1 | 2>();
  const reportedCycle = new Set<TaskNode>();

  const anchorOf = (t: TaskNode): Day => {
    let a: Day | null = t.spec.start ? parseIso(t.spec.start) : null;
    for (const dep of t.deps) {
      resolve(dep);
      a = a === null ? dep.end : Math.max(a, dep.end);
    }
    return a ?? defaultAnchor(t);
  };

  const defaultAnchor = (t: TaskNode): Day => {
    const siblings = t.parent ? t.parent.children : t.section.tasks;
    const idx = siblings.indexOf(t);
    if (idx > 0) {
      const prev = siblings[idx - 1];
      resolve(prev);
      return prev.end;
    }
    if (t.parent) return anchorOf(t.parent);
    return p0;
  };

  const resolve = (t: TaskNode): void => {
    const st = state.get(t);
    if (st === 2) return;
    if (st === 1) {
      if (!reportedCycle.has(t)) {
        reportedCycle.add(t);
        diags.push({ line: t.line, from: 0, to: 9999, message: 'Dependencia circular: esta tarea termina dependiendo de sí misma', severity: 'error' });
      }
      t.start = t.end = p0;
      return;
    }
    state.set(t, 1);
    if (t.children.length) {
      for (const c of t.children) resolve(c);
      t.start = Math.min(...t.children.map((c) => c.start));
      t.end = Math.max(...t.children.map((c) => c.end));
    } else {
      const a = anchorOf(t);
      if (t.spec.milestone) {
        t.start = t.end = a;
      } else if (t.spec.end) {
        t.start = a;
        t.end = Math.max(a + 1, parseIso(t.spec.end)! + 1);
      } else {
        const d = t.spec.duration;
        const n = d ? (d.unit === 'w' ? d.n * wpw : d.n) : 1;
        t.start = nextWorkday(cal, a);
        t.end = addWorkdays(cal, t.start, n);
      }
    }
    state.set(t, 2);
  };

  for (const t of doc.tasks) resolve(t);

  for (const s of doc.sections) {
    const all = s.tasks;
    if (all.length) {
      s.start = Math.min(...all.map((t) => t.start));
      s.end = Math.max(...all.map((t) => t.end));
    } else {
      s.start = s.end = p0;
    }
  }

  return doc;
}

function isAncestor(a: TaskNode, b: TaskNode): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** ¿Agregar `from` como dependencia de `to` generaría un ciclo? */
export function wouldCreateCycle(from: TaskNode, to: TaskNode): boolean {
  if (from === to || isAncestor(from, to) || isAncestor(to, from)) return true;
  // ¿`from` depende (directa o indirectamente) de `to` o de algo dentro de `to`?
  const seen = new Set<TaskNode>();
  const stack = [from];
  const pushTree = (t: TaskNode) => {
    stack.push(t);
    t.children.forEach(pushTree);
  };
  while (stack.length) {
    const t = stack.pop()!;
    if (t === to || isAncestor(to, t)) return true;
    if (seen.has(t)) continue;
    seen.add(t);
    for (let x: TaskNode | null = t; x; x = x.parent) x.deps.forEach(pushTree);
  }
  return false;
}
