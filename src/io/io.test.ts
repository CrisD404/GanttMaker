import { describe, expect, it } from 'vitest';
import { parseIso } from '../core/dates';
import { compile } from '../core/index';
import { findTask } from '../core/schedule';
import { resolveView } from '../core/views';
import { SAMPLE } from '../samples';
import { exportSvg } from './export';
import { looksLikeMermaid, mermaidToGantt } from './mermaid';

const TODAY = parseIso('2026-10-02')!;

describe('importar Mermaid', () => {
  const MERMAID = `gantt
    title Plan de prueba
    dateFormat YYYY-MM-DD
    excludes weekends
    section Diseño
    Bocetos           :done, a1, 2026-11-02, 5d
    Prototipo         :active, a2, after a1, 3d
    section Desarrollo
    API               :crit, b1, after a2, 2w
    Entrega           :milestone, after b1, 0d`;

  it('detecta y convierte un gantt de Mermaid', () => {
    expect(looksLikeMermaid(MERMAID)).toBe(true);
    const doc = compile(mermaidToGantt(MERMAID), TODAY);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.title).toBe('Plan de prueba');
    expect(findTask(doc, 'Prototipo')!.deps.map((t) => t.spec.name)).toEqual(['Bocetos']);
    expect(findTask(doc, 'API')!.critical).toBe(true);
    expect(findTask(doc, 'Entrega')!.spec.milestone).toBe(true);
    expect(findTask(doc, 'Bocetos')!.status).toBe('done');
  });

  it('no confunde un documento propio con Mermaid', () => {
    expect(looksLikeMermaid(SAMPLE)).toBe(false);
  });
});

describe('exportar SVG', () => {
  it('genera un SVG válido con todas las tareas visibles', () => {
    const doc = compile(SAMPLE, TODAY);
    const { svg, width, height } = exportSvg({
      doc, settings: resolveView(doc, null), collapsed: new Set(), zoom: 1, today: TODAY, theme: 'light', viewName: null,
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(200);
    expect(svg).toContain('Endpoints de pagos');
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });

  it('respeta el nivel de detalle de la vista', () => {
    const doc = compile(SAMPLE, TODAY);
    const { svg } = exportSvg({
      doc, settings: resolveView(doc, 'Ejecutivo'), collapsed: new Set(), zoom: 1, today: TODAY, theme: 'dark', viewName: 'Ejecutivo',
    });
    expect(svg).toContain('Desarrollo');
    expect(svg).not.toContain('Endpoints de pagos');
  });
});
