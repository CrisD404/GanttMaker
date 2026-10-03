import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../samples';
import { parseIso, toIso, addWorkdays, DEFAULT_CALENDAR } from './dates';
import { compile } from './index';
import { findTask } from './schedule';
import { resolveView } from './views';
import {
  addDependency, deleteTask, insertTask, moveTask, retimeTask, serializeTask, setFeature, setSetting, updateTask,
} from './writer';

const TODAY = parseIso('2026-10-02')!;
const c = (text: string) => compile(text, TODAY);
const task = (text: string, name: string) => {
  const doc = c(text);
  const t = findTask(doc, name);
  if (!t) throw new Error('no task ' + name);
  return { doc, t, start: toIso(t.start), end: toIso(t.end - 1) };
};

describe('dates', () => {
  it('suma días laborables saltando fines de semana', () => {
    const fri = parseIso('2026-10-09')!;
    expect(toIso(addWorkdays(DEFAULT_CALENDAR, fri, 2) - 1)).toBe('2026-10-12');
  });
});

describe('parser', () => {
  it('parsea el ejemplo sin errores', () => {
    const doc = c(SAMPLE);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.title).toBe('Lanzamiento App Móvil');
    expect(doc.sections.map((s) => s.name)).toEqual(['Descubrimiento', 'Diseño', 'Desarrollo', 'Lanzamiento']);
    expect(doc.views.map((v) => v.name)).toEqual(['Ejecutivo', 'Backend']);
    expect(doc.owners.get('luis')?.team).toBe('Backend');
  });

  it('lee atributos de tarea en cualquier orden', () => {
    const doc = c('section A\n  Diseño UX #crit 60% @Ana 5d #f00');
    const t = doc.tasks[0];
    expect(t.spec).toMatchObject({ name: 'Diseño UX', owners: ['Ana'], duration: { n: 5, unit: 'd' }, progress: 60, tags: ['crit'], color: '#f00' });
    expect(t.critical).toBe(true);
  });

  it('acepta nombres entre comillas que parecen atributos', () => {
    const doc = c('section A\n  "Fase 2d" 3d');
    expect(doc.tasks[0].spec.name).toBe('Fase 2d');
    expect(doc.tasks[0].spec.duration?.n).toBe(3);
  });

  it('arma la jerarquía por indentación', () => {
    const doc = c(SAMPLE);
    const api = findTask(doc, 'API')!;
    expect(api.children.map((x) => x.spec.name)).toEqual(['Modelo de datos', 'Autenticación', 'Endpoints de pagos']);
  });

  it('informa errores con línea', () => {
    const doc = c('start 2026-13-40\nsection A\n  T after Nada');
    expect(doc.diagnostics.map((d) => d.line)).toEqual([0, 2]);
  });

  it('detecta dependencias circulares', () => {
    const doc = c('section A\n  X 1d after Y\n  Y 1d after X');
    expect(doc.diagnostics.some((d) => d.message.includes('circular'))).toBe(true);
  });

  it('una línea con keyword inválida dentro de una sección es una tarea', () => {
    const doc = c('section A\nshow demo 2d');
    expect(doc.tasks[0]?.spec.name).toBe('show demo');
  });
});

describe('scheduler', () => {
  it('encadena tareas secuenciales por defecto', () => {
    const { start } = task(SAMPLE, 'Benchmark de mercado');
    expect(start).toBe('2026-10-12'); // después de 5 días hábiles desde el lunes 5
  });

  it('respeta after con varias dependencias', () => {
    const { start } = task(SAMPLE, 'Definición de alcance');
    expect(start).toBe('2026-10-15');
  });

  it('las tareas padre abarcan a sus hijas', () => {
    const { t, doc } = task(SAMPLE, 'API');
    const kids = t.children;
    expect(t.start).toBe(Math.min(...kids.map((k) => k.start)));
    expect(t.end).toBe(Math.max(...kids.map((k) => k.end)));
    expect(doc.diagnostics).toEqual([]);
  });

  it('salta feriados', () => {
    const { end } = task('calendar mon-fri\nholiday 2026-10-07\nsection A\n  T 2026-10-05 3d', 'T');
    expect(end).toBe('2026-10-08');
  });
});

describe('vistas', () => {
  it('combina ajustes base y de la vista', () => {
    const doc = c(SAMPLE);
    const exec = resolveView(doc, 'Ejecutivo');
    expect(exec.scale).toBe('month');
    expect(exec.detail).toBe(1);
    expect(exec.columns).toEqual([]);
    expect(exec.features.avatars).toBe(false);
    expect(resolveView(doc, 'Backend').filterOwners).toEqual(['Backend']);
  });
});

describe('writer', () => {
  it('serializa en forma canónica', () => {
    expect(serializeTask({ name: 'API', owners: ['Luis'], tags: ['crit'], after: ['Diseño'], milestone: false, duration: { n: 3, unit: 'd' }, progress: 20 }))
      .toBe('API @Luis 3d after Diseño 20% #crit');
  });

  it('round-trip: serializar y reparsear da la misma spec', () => {
    const doc = c(SAMPLE);
    for (const t of doc.tasks) {
      const re = c('section X\n  ' + serializeTask(t.spec)).tasks[0];
      expect(re.spec).toEqual(t.spec);
    }
  });

  it('mover una tarea cambia solo su línea', () => {
    const doc = c(SAMPLE);
    const t = findTask(doc, 'Benchmark de mercado')!;
    const out = retimeTask(SAMPLE, doc, t.key, t.start + 7, t.end + 7, 'move');
    const a = SAMPLE.split('\n'), b = out.split('\n');
    const changed = a.map((l, i) => (l !== b[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual([t.line]);
    expect(b[t.line]).toBe('  Benchmark de mercado @Ana 2026-10-19 3d #done');
  });

  it('redimensionar actualiza la duración', () => {
    const doc = c(SAMPLE);
    const t = findTask(doc, 'Modelo de datos')!;
    const out = retimeTask(SAMPLE, doc, t.key, t.start, t.end + 2, 'resize-end');
    expect(findTask(c(out), 'Modelo de datos')!.spec.duration).toEqual({ n: 5, unit: 'd' });
  });

  it('renombrar actualiza referencias', () => {
    const doc = c(SAMPLE);
    const t = findTask(doc, 'Wireframes')!;
    const out = updateTask(SAMPLE, doc, t.key, { name: 'Bocetos' });
    const d2 = c(out);
    expect(d2.diagnostics).toEqual([]);
    expect(findTask(d2, 'Prototipo navegable')!.spec.after).toContain('Bocetos');
  });

  it('borrar quita la tarea, sus hijas y referencias', () => {
    const doc = c(SAMPLE);
    const out = deleteTask(SAMPLE, doc, findTask(doc, 'API')!.key);
    const d2 = c(out);
    expect(d2.diagnostics).toEqual([]);
    expect(findTask(d2, 'Autenticación')).toBeUndefined();
  });

  it('insertar y mover tareas', () => {
    let doc = c(SAMPLE);
    let out = insertTask(SAMPLE, doc, { kind: 'child', key: findTask(doc, 'API')!.key }, { name: 'Webhooks', owners: [], tags: [], after: [], milestone: false, duration: { n: 2, unit: 'd' } });
    doc = c(out);
    expect(findTask(doc, 'Webhooks')!.parent?.spec.name).toBe('API');
    out = moveTask(out, doc, findTask(doc, 'Webhooks')!.key, findTask(doc, 'Wireframes')!.key, 'before');
    doc = c(out);
    expect(findTask(doc, 'Webhooks')!.section.name).toBe('Diseño');
    expect(findTask(doc, 'Webhooks')!.depth).toBe(0);
    expect(doc.diagnostics).toEqual([]);
  });

  it('agrega dependencias', () => {
    const doc = c(SAMPLE);
    const out = addDependency(SAMPLE, doc, findTask(doc, 'Benchmark de mercado')!.key, findTask(doc, 'Wireframes')!.key);
    expect(findTask(c(out), 'Wireframes')!.spec.after).toEqual(['Alcance aprobado', 'Benchmark de mercado']);
  });

  it('escribe ajustes en la vista o en el nivel superior', () => {
    let doc = c(SAMPLE);
    let out = setSetting(SAMPLE, doc, 'Ejecutivo', 'scale', 'quarter');
    expect(resolveView(c(out), 'Ejecutivo').scale).toBe('quarter');
    doc = c(out);
    out = setSetting(out, doc, null, 'density', 'compact');
    expect(out.split('\n')[4]).toBe('density compact');
    expect(c(out).diagnostics).toEqual([]);
  });

  it('show/hide se reescribe correctamente', () => {
    const doc = c(SAMPLE);
    let out = setFeature(SAMPLE, doc, 'Ejecutivo', 'avatars', true);
    expect(out).not.toContain('hide avatars');
    out = setFeature(out, c(out), 'Ejecutivo', 'deps', false);
    expect(resolveView(c(out), 'Ejecutivo').features.deps).toBe(false);
    expect(resolveView(c(out), null).features.deps).toBe(true);
  });
});
