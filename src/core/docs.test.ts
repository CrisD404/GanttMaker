// La documentación es parte del producto: sus ejemplos tienen que compilar sin errores.
import { describe, expect, it } from 'vitest';
import llmGuide from '../../docs/LLM.md?raw';
import syntaxDoc from '../../docs/SINTAXIS.md?raw';
import { TEMPLATES } from '../templates';
import { parseIso } from './dates';
import { compile } from './index';
import { resolveView } from './views';

const TODAY = parseIso('2026-10-02')!;

function blocks(md: string, lang: string): string[] {
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  return [...md.matchAll(re)].map((m) => m[1]);
}

describe('documentación', () => {
  it('los ejemplos `gantt` de la guía para LLMs compilan sin problemas', () => {
    const examples = blocks(llmGuide, 'gantt');
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const ex of examples) {
      const d = compile(ex, TODAY);
      expect(d.diagnostics, ex.slice(0, 60)).toEqual([]);
      expect(d.tasks.length).toBeGreaterThan(0);
    }
  });

  it('todas las plantillas compilan sin problemas y sus vistas existen', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(6);
    for (const t of TEMPLATES) {
      const d = compile(t.text, TODAY);
      expect(d.diagnostics, t.id).toEqual([]);
      expect(d.title, t.id).not.toBe('');
      for (const v of d.views) expect(() => resolveView(d, v.name)).not.toThrow();
    }
  });

  it('los ejemplos completos de SINTAXIS.md compilan sin problemas', () => {
    // Bloques que empiezan con "gantt" son documentos completos (el resto son fragmentos)
    const full = blocks(syntaxDoc, '').filter((b) => b.startsWith('gantt'));
    expect(full.length).toBeGreaterThanOrEqual(2);
    for (const ex of full) expect(compile(ex, TODAY).diagnostics, ex.slice(0, 60)).toEqual([]);
  });
});
