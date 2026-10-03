// Genera las imágenes del README a partir de los ejemplos reales (mismo motor de exportación de la app).
// Uso: npm run readme:images
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { compile } = await server.ssrLoadModule('/src/core/index.ts');
  const { parseIso } = await server.ssrLoadModule('/src/core/dates.ts');
  const { resolveView } = await server.ssrLoadModule('/src/core/views.ts');
  const { exportSvg } = await server.ssrLoadModule('/src/io/export.ts');
  const { BASE_PX_PER_DAY } = await server.ssrLoadModule('/src/render/layout.ts');
  const { SAMPLE, SAMPLE_SPRINTS } = await server.ssrLoadModule('/src/samples.ts');

  // Un "hoy" fijo dentro del proyecto, para que las imágenes no cambien con cada ejecución
  const today = parseIso('2026-10-21');
  mkdirSync('docs/assets', { recursive: true });

  const render = (text, name, width, view = null) => {
    const doc = compile(text, today);
    const settings = resolveView(doc, view);
    const start = Math.min(...doc.tasks.map((t) => t.start));
    const end = Math.max(...doc.tasks.map((t) => t.end));
    const zoom = width / (end - start + 10) / BASE_PX_PER_DAY[settings.scale];
    for (const theme of ['light', 'dark']) {
      const { svg } = exportSvg({ doc, settings, collapsed: new Set(), zoom, today, theme, viewName: view });
      writeFileSync(`docs/assets/${name}-${theme}.svg`, svg);
      console.log(`docs/assets/${name}-${theme}.svg`);
    }
  };

  render(SAMPLE, 'preview', 1100);
  render(SAMPLE, 'executive', 900, 'Ejecutivo');
  render(SAMPLE_SPRINTS, 'sprints', 1000);
} finally {
  await server.close();
}
