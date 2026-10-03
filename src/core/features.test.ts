import { describe, expect, it } from 'vitest';
import { SAMPLE, SAMPLE_SPRINTS } from '../samples';
import { parseIso, toIso } from './dates';
import { compile } from './index';
import { sprintsInRange } from './sprints';
import { resolveView } from './views';
import { setSetting, setSprintCadence } from './writer';
import { computeLayout, tiersFor, type QuickFilter } from '../render/layout';
import { depRoute } from '../render/paths';

const TODAY = parseIso('2026-10-02')!;
const c = (t: string) => compile(t, TODAY);

describe('sprints', () => {
  it('genera sprints por cadencia con patrón y numeración', () => {
    const d = c(SAMPLE_SPRINTS);
    expect(d.diagnostics).toEqual([]);
    expect(d.sprintCadence).toMatchObject({ length: 14, pattern: 'Sprint {n}', first: 14 });
    const sp = sprintsInRange(d, parseIso('2026-10-01')!, parseIso('2026-11-15')!);
    // 5 oct, 19 oct y 2 nov (el siguiente empieza el 16 nov, fuera del rango)
    expect(sp.map((s) => s.name)).toEqual(['Sprint 14', 'Sprint 15', 'Sprint 16']);
    expect(toIso(sp[0].start)).toBe('2026-10-05'); // lunes de la semana de inicio
    expect(sp[1].start - sp[0].start).toBe(14);
  });

  it('acepta "from" y duración en días corridos', () => {
    const d = c('start 2026-10-05\nsprints 10d from 2026-10-07 "It. {n}"\nsection A\n  T 3d');
    const sp = sprintsInRange(d, parseIso('2026-10-01')!, parseIso('2026-10-30')!);
    expect(sp[0]).toMatchObject({ name: 'It. 1', start: parseIso('2026-10-07') });
    expect(sp[1].start - sp[0].start).toBe(10);
  });

  it('sprints explícitos tienen prioridad sobre la cadencia', () => {
    const d = c('sprints 2w\nsprint "Kickoff" 2026-10-05..2026-10-09\nsprint Hardening 2026-12-01 1w\nsection A\n  T 2026-10-05 3d');
    expect(d.diagnostics).toEqual([]);
    const sp = sprintsInRange(d, parseIso('2026-09-01')!, parseIso('2027-01-01')!);
    expect(sp.map((s) => [s.name, toIso(s.start), toIso(s.end - 1)])).toEqual([
      ['Kickoff', '2026-10-05', '2026-10-09'],
      ['Hardening', '2026-12-01', '2026-12-07'],
    ]);
  });

  it('una tarea llamada "Sprint review" dentro de una sección sigue siendo tarea', () => {
    const d = c('section A\nsprint review 2d');
    expect(d.tasks[0]?.spec.name).toBe('sprint review');
  });

  it('la escala sprint usa una cadencia por defecto si no hay sprints', () => {
    const d = c('start 2026-10-05\nscale sprint\nsection A\n  T 20d');
    const L = computeLayout({ doc: d, settings: resolveView(d, null), collapsed: new Set(), zoom: 1, today: TODAY, minChartWidth: 0 });
    expect(L.top[0].label).toMatch(/^Sprint \d+$/);
  });

  it('el writer agrega, cambia y quita la línea sprints', () => {
    let text = SAMPLE;
    text = setSprintCadence(text, c(text), '3w "S{n}"');
    expect(c(text).sprintCadence?.length).toBe(21);
    text = setSprintCadence(text, c(text), '1w');
    expect(c(text).sprintCadence?.length).toBe(7);
    text = setSprintCadence(text, c(text), null);
    expect(c(text).sprintCadence).toBeNull();
    expect(c(text).diagnostics).toEqual([]);
  });
});

describe('filtros', () => {
  it('filter acepta texto entre comillas', () => {
    const text = setSetting(SAMPLE, c(SAMPLE), null, 'filter', '@Backend "pagos"');
    const s = resolveView(c(text), null);
    expect(s.filterOwners).toEqual(['Backend']);
    expect(s.filterText).toBe('pagos');
  });

  const layout = (q: QuickFilter) => {
    const d = c(SAMPLE);
    return computeLayout({ doc: d, settings: resolveView(d, null), collapsed: new Set(), zoom: 1, today: TODAY, minChartWidth: 0, quick: q });
  };

  it('filtro rápido en modo ocultar', () => {
    const L = layout({ owners: ['Luis'], tags: [], text: '', mode: 'hide' });
    const names = L.rows.filter((r) => r.task && !r.task.children.length).map((r) => r.label);
    expect(names).toEqual(['Modelo de datos', 'Autenticación', 'Endpoints de pagos']);
    expect(L.matchCount).toBe(3);
  });

  it('filtro rápido en modo atenuar conserva las filas', () => {
    const all = layout({ owners: [], tags: [], text: '', mode: 'dim' });
    const L = layout({ owners: [], tags: ['crit'], text: '', mode: 'dim' });
    expect(L.rows.length).toBe(all.rows.length);
    expect(L.rows.find((r) => r.label === 'Autenticación')?.dimmed).toBe(false);
    expect(L.rows.find((r) => r.label === 'Wireframes')?.dimmed).toBe(true);
  });

  it('la búsqueda ignora acentos y mayúsculas', () => {
    const L = layout({ owners: [], tags: [], text: 'AUTENTICACION', mode: 'hide' });
    expect(L.matchCount).toBe(1);
  });
});

describe('eje adaptativo', () => {
  it('elige unidades según el zoom', () => {
    expect(tiersFor('week', 22).bottom).toBe('week');
    expect(tiersFor('week', 60).bottom).toBe('day');
    expect(tiersFor('month', 4.5)).toEqual({ top: 'year', bottom: 'month' });
    expect(tiersFor('sprint', 12)).toEqual({ top: 'sprint', bottom: 'week' });
  });
});

describe('flechas de dependencia', () => {
  const commands = (d: string) => d.replace(/[^A-Z]/g, '');
  it('las dos rutas tienen la misma estructura (animables con CSS)', () => {
    const fwd = depRoute({ x1: 100, y1: 18, x2: 300, y2: 90, toRowTop: 72, rowH: 36 });
    const back = depRoute({ x1: 300, y1: 18, x2: 120, y2: 90, toRowTop: 72, rowH: 36 });
    expect(commands(fwd.d)).toBe(commands(back.d));
    expect(fwd.d).not.toContain('NaN');
    expect(back.d).not.toContain('NaN');
  });
  it('la ruta hacia atrás usa el carril entre filas', () => {
    const back = depRoute({ x1: 300, y1: 18, x2: 120, y2: 90, toRowTop: 72, rowH: 36 });
    expect(back.mid[1]).toBe(72);
  });
});
