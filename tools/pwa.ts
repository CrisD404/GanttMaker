// La app como "descargable":
//  1. PWA instalable: manifest + íconos + service worker que la deja funcionando sin conexión.
//  2. ganttmaker.html: toda la app en UN archivo (JS y CSS embebidos) para abrir desde el disco.
import { createHash } from 'node:crypto';
import type { Plugin, Rollup } from 'vite';

type OutputAsset = Rollup.OutputAsset;
type OutputChunk = Rollup.OutputChunk;
import { buildIcons } from './icons.ts';

export const OFFLINE_FILE = 'ganttmaker.html';

const MANIFEST = {
  name: 'GanttMaker',
  short_name: 'GanttMaker',
  description: 'Diagramas de Gantt como código, con una interfaz totalmente interactiva. Funciona sin conexión.',
  lang: 'es',
  start_url: './',
  scope: './',
  display: 'standalone',
  display_override: ['window-controls-overlay', 'standalone'],
  background_color: '#0d0f15',
  theme_color: '#5b5bf7',
  categories: ['productivity', 'business'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  // Abrir archivos .gantt / .mmd con la app instalada (Chrome/Edge)
  file_handlers: [{ action: './', accept: { 'text/plain': ['.gantt', '.mmd'] } }],
};

function serviceWorker(version: string, assets: string[]): string {
  return `// Generado en el build. Cachea la app para que funcione sin conexión.
const CACHE = 'ganttmaker-${version}';
const FONTS = 'ganttmaker-fonts';
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ganttmaker-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Páginas: primero la red (para tener la última versión), si no hay conexión la copia local
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  // Tipografías: la copia guardada al instante y se actualiza en segundo plano
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        }),
      ),
    );
    return;
  }
  // Archivos de la app: primero la caché
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
`;
}

/** Inserta JS y CSS dentro del HTML: un solo archivo que funciona abierto desde el disco. */
function inlineHtml(html: string, js: string, css: string): string {
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  return html
    .replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '')
    .replace(/<link rel="stylesheet"[^>]*href="[^"]*\.css"[^>]*>/, () => `<style>\n${css}\n</style>`)
    .replace(/<link rel="manifest"[^>]*>/, '')
    .replace(/<link rel="apple-touch-icon"[^>]*>/, '')
    .replace('</body>', () => `<script>window.__GM_OFFLINE__ = true;</script>\n<script type="module">\n${safeJs}\n</script>\n</body>`);
}

export function pwaPlugin(): Plugin {
  let icons: Record<string, Buffer> | null = null;
  const getIcons = () => (icons ??= buildIcons());
  return {
    name: 'ganttmaker-pwa',
    enforce: 'post',
    configureServer(server) {
      // En desarrollo se sirven el manifest y los íconos (el service worker solo existe en el build)
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        if (path === 'manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(JSON.stringify(MANIFEST, null, 2));
          return;
        }
        const icon = getIcons()[path];
        if (icon) {
          res.setHeader('Content-Type', 'image/png');
          res.end(icon);
          return;
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      for (const [fileName, source] of Object.entries(getIcons())) this.emitFile({ type: 'asset', fileName, source });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) });

      // Archivo único offline
      const html = Object.values(bundle).find((f): f is OutputAsset => f.type === 'asset' && f.fileName === 'index.html');
      const entry = Object.values(bundle).find((f): f is OutputChunk => f.type === 'chunk' && f.isEntry);
      const css = Object.values(bundle).filter((f): f is OutputAsset => f.type === 'asset' && f.fileName.endsWith('.css'));
      if (html && entry) {
        const single = inlineHtml(String(html.source), entry.code, css.map((c) => String(c.source)).join('\n'));
        this.emitFile({ type: 'asset', fileName: OFFLINE_FILE, source: single });
      }

      // Service worker con la lista de archivos (el nombre de la caché cambia con cada build)
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== OFFLINE_FILE && !f.startsWith('skill/') && !f.startsWith('llms'));
      const assets = ['./', ...files.map((f) => `./${f}`), './manifest.webmanifest', ...Object.keys(getIcons()).map((f) => `./${f}`)];
      const version = createHash('sha256').update(assets.join('|')).digest('hex').slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(version, [...new Set(assets)]) });
    },
  };
}
