// "Descargable": instalación como app (PWA), actualizaciones y archivos abiertos desde el sistema.
import { signal } from '@preact/signals';
import { openTextFile } from '../io/files';
import { toast } from './store';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LaunchParams {
  files: { getFile: () => Promise<File> }[];
}

declare global {
  interface Window {
    __GM_OFFLINE__?: boolean;
    launchQueue?: { setConsumer: (cb: (p: LaunchParams) => void) => void };
  }
}

/** Evento de instalación que ofrece el navegador (Chrome/Edge). */
export const installPrompt = signal<BeforeInstallPromptEvent | null>(null);
export const installDialogOpen = signal(false);

export const isStandalone =
  typeof window !== 'undefined' &&
  (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Corriendo desde el archivo HTML descargado (sin servidor). */
export const isOfflineFile = typeof window !== 'undefined' && (window.__GM_OFFLINE__ === true || location.protocol === 'file:');

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.value = e as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null;
    toast('GanttMaker quedó instalada: la encontrás entre tus aplicaciones', 'success');
  });

  // Service worker: solo en el build publicado (http/https)
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'activated' && hadController) {
            toast('Hay una versión nueva de GanttMaker', 'info', { label: 'Recargar', run: () => location.reload() });
          }
        });
      });
    }).catch(() => { /* sin service worker la app funciona igual, solo que no offline */ });
  }

  // Archivos .gantt / .mmd abiertos con la app instalada
  window.launchQueue?.setConsumer(async (params) => {
    for (const h of params.files ?? []) openTextFile(await h.getFile());
  });
}

export async function promptInstall(): Promise<boolean> {
  const p = installPrompt.value;
  if (!p) return false;
  await p.prompt();
  const r = await p.userChoice;
  installPrompt.value = null;
  return r.outcome === 'accepted';
}

/** Instrucciones de instalación según el navegador (cuando no hay aviso automático). */
export function installHint(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'En Safari: botón Compartir → "Agregar a inicio".';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'En Safari (macOS): menú Archivo → "Agregar al Dock".';
  if (/Firefox/.test(ua)) return 'Firefox no instala aplicaciones web: usá el archivo HTML sin conexión.';
  if (!import.meta.env.PROD) return 'La instalación está disponible en la versión publicada (npm run build).';
  return 'En Chrome o Edge: ícono de instalar en la barra de direcciones, o menú ⋮ → "Instalar GanttMaker".';
}
