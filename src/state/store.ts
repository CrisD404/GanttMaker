import { computed, effect, signal } from '@preact/signals';
import { redo as cmRedo, undo as cmUndo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { ComponentChildren } from 'preact';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { todayDay, type Day } from '../core/dates';
import { compileCached } from '../core/index';
import { parse } from '../core/parser';
import type { GanttDoc } from '../core/types';
import { resolveView } from '../core/views';
import { setTitle } from '../core/writer';
import { EMPTY_QUICK, type QuickFilter } from '../render/layout';
import { SAMPLE } from '../samples';

// ---------------------------------------------------------------------------
// Almacenamiento local (todo en el navegador, sin servidor)
// ---------------------------------------------------------------------------

const LS_INDEX = 'ganttmaker:spaces';
const LS_CURRENT = 'ganttmaker:current';
const LS_LEGACY_DOC = 'ganttmaker:doc';
const LS_THEME = 'ganttmaker:theme';
const LS_EDITOR = 'ganttmaker:editor';
const LS_DOCK = 'ganttmaker:dock';
const spaceKey = (id: string) => `ganttmaker:space:${id}`;

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
/** Devuelve false si no se pudo guardar (almacenamiento lleno o bloqueado). */
function lsSet(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}
function lsDel(k: string) {
  try { localStorage.removeItem(k); } catch { /* idem */ }
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------------------
// Espacios: cada uno es un diagrama independiente
// ---------------------------------------------------------------------------

export interface SpaceMeta {
  id: string;
  title: string;
  created: number;
  updated: number;
  tasks: number;
  /** Vista activa la última vez. */
  view: string | null;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function metaFor(id: string, text: string, prev?: SpaceMeta): SpaceMeta {
  const d = parse(text);
  const now = Date.now();
  return {
    id,
    title: d.title || 'Sin título',
    created: prev?.created ?? now,
    updated: now,
    tasks: d.tasks.length,
    view: prev?.view ?? null,
  };
}

function readIndex(): SpaceMeta[] {
  try {
    const raw = lsGet(LS_INDEX);
    const arr = raw ? (JSON.parse(raw) as SpaceMeta[]) : [];
    return Array.isArray(arr) ? arr.filter((m) => m && typeof m.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Texto compartido por enlace: `#code=` (lz-string) o `#src=` (texto plano codificado, ideal para LLMs). */
function readLinkText(): string | null {
  const hash = location.hash;
  let text: string | null = null;
  const code = /[#&]code=([^&]+)/.exec(hash);
  const src = /[#&]src=([^&]+)/.exec(hash);
  if (code) text = decompressFromEncodedURIComponent(code[1]);
  else if (src) {
    try { text = decodeURIComponent(src[1].replace(/\+/g, '%20')); } catch { text = null; }
  }
  if (code || src) history.replaceState(null, '', location.pathname + location.search);
  return text ? normalize(text) : null;
}

function initSpaces(): { index: SpaceMeta[]; current: string; text: string; fromLink: boolean } {
  let index = readIndex();
  // Migración desde la versión de un solo documento
  const legacy = lsGet(LS_LEGACY_DOC);
  if (!index.length && legacy) {
    const id = newId();
    lsSet(spaceKey(id), legacy);
    index = [metaFor(id, legacy)];
    lsDel(LS_LEGACY_DOC);
  }
  let current = lsGet(LS_CURRENT) ?? '';
  // Un enlace compartido siempre abre un espacio nuevo: nunca pisa lo que ya tenías
  const linkText = readLinkText();
  if (linkText) {
    const id = newId();
    lsSet(spaceKey(id), linkText);
    index = [metaFor(id, linkText), ...index];
    current = id;
  }
  if (!index.length) {
    const id = newId();
    lsSet(spaceKey(id), SAMPLE);
    index = [metaFor(id, SAMPLE)];
  }
  if (!index.some((m) => m.id === current)) current = [...index].sort((a, b) => b.updated - a.updated)[0].id;
  lsSet(LS_INDEX, JSON.stringify(index));
  lsSet(LS_CURRENT, current);
  return { index, current, text: normalize(lsGet(spaceKey(current)) ?? ''), fromLink: !!linkText };
}

const init = initSpaces();

export const spaces = signal<SpaceMeta[]>(init.index);
export const currentSpaceId = signal(init.current);
export const openedFromLink = init.fromLink;

// ---------------------------------------------------------------------------
// Estado del documento
// ---------------------------------------------------------------------------

export const today = todayDay();
export const source = signal(init.text);

export const doc = computed<GanttDoc>(() => compileCached(source.value, today));

export const activeView = signal<string | null>(init.index.find((m) => m.id === init.current)?.view ?? null);
/** La vista activa, o null si ya no existe en el documento. */
export const currentView = computed(() => {
  const v = activeView.value;
  return v && doc.value.views.some((x) => x.name === v) ? v : null;
});
export const settings = computed(() => resolveView(doc.value, currentView.value));

export const selectedKey = signal<string | null>(null);
export const selectedTask = computed(() => {
  const k = selectedKey.value;
  return k ? doc.value.tasks.find((t) => t.key === k) ?? null : null;
});
export const inspectorOpen = signal(false);

export const collapsed = signal<Set<string>>(new Set());

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 40;
export const zoom = signal(1);
export function setZoom(z: number) {
  zoom.value = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 1000) / 1000;
}
/** true mientras se anima un cambio de zoom/escala (se desactivan las transiciones CSS). */
export const zooming = signal(false);

/** Filtro rápido: se aplica al instante y no toca el código. */
export const quickFilter = signal<QuickFilter>({ ...EMPTY_QUICK });
export const dockOpen = signal(lsGet(LS_DOCK) !== 'closed');

type Theme = 'light' | 'dark';
const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
export const theme = signal<Theme>((lsGet(LS_THEME) as Theme) || (prefersDark ? 'dark' : 'light'));

export const editorOpen = signal(lsGet(LS_EDITOR) !== 'closed');
export const helpOpen = signal(false);

/** Modo presentación: pantalla completa, solo lectura, con láser y foco. */
export const presenting = signal(false);
export type PresentTool = 'pointer' | 'laser' | 'spotlight';
export const presentTool = signal<PresentTool>('pointer');

// ---------------------------------------------------------------------------
// Pedidos a la vista del gantt (scroll / ajustar zoom a un período)
// ---------------------------------------------------------------------------

export const scrollRequest = signal<{ day: Day; nonce: number; align: 'start' | 'third' } | null>(null);
export function scrollToDay(day: Day, align: 'start' | 'third' = 'third') {
  scrollRequest.value = { day, nonce: Math.random(), align };
}
export const fitRequest = signal<{ start: Day; end: Day; nonce: number } | null>(null);
/** Anima el zoom para que el período [start, end) ocupe el ancho visible. */
export function fitPeriod(start: Day, end: Day) {
  fitRequest.value = { start, end, nonce: Math.random() };
}
export function fitProject() {
  const ts = doc.value.tasks;
  if (!ts.length) return;
  fitPeriod(Math.min(...ts.map((t) => t.start)), Math.max(...ts.map((t) => t.end)));
}

// ---------------------------------------------------------------------------
// Notificaciones y menú contextual global
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-3), { id, message, kind, action }];
  setTimeout(() => dismissToast(id), action ? 5200 : 3200);
}
export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
/** Aviso con botón "Deshacer" que deshace el último cambio del documento. */
export function toastUndo(message: string) {
  toast(message, 'info', { label: 'Deshacer', run: undo });
}

export interface MenuEntry {
  label?: string;
  icon?: ComponentChildren;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  separator?: boolean;
  /** Título de grupo (no clickeable). */
  heading?: string;
  /** Contenido libre (p. ej. una fila de colores). Recibe `close`. */
  custom?: (close: () => void) => ComponentChildren;
}
export const contextMenu = signal<{ x: number; y: number; items: MenuEntry[] } | null>(null);
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuEntry[]) {
  e.preventDefault?.();
  contextMenu.value = { x: e.clientX, y: e.clientY, items };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

/** Estado del guardado local (se muestra en la barra superior). */
export const saveState = signal<'saved' | 'saving' | 'error'>('saved');
/** El navegador garantiza no borrar los datos por falta de espacio (`navigator.storage.persist`). */
export const storagePersisted = signal<boolean | null>(null);

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: (() => void) | null = null;
const lastSaved = new Map<string, string>([[init.current, init.text]]);
let warnedQuota = false;
let askedPersist = false;

/** Pide almacenamiento persistente (solo una vez y recién cuando el usuario editó algo). */
function requestPersistence() {
  if (askedPersist || typeof navigator === 'undefined' || !navigator.storage?.persist) return;
  askedPersist = true;
  navigator.storage.persisted()
    .then((p) => p || navigator.storage.persist())
    .then((p) => (storagePersisted.value = p))
    .catch(() => (storagePersisted.value = false));
}
if (typeof navigator !== 'undefined') navigator.storage?.persisted?.().then((p) => (storagePersisted.value = p)).catch(() => {});

function saveNow(id: string, text: string) {
  if (lastSaved.get(id) === text) {
    saveState.value = 'saved';
    return;
  }
  if (!lsSet(spaceKey(id), text)) {
    saveState.value = 'error';
    if (!warnedQuota) {
      warnedQuota = true;
      toast('No se pudo guardar en el navegador (almacenamiento lleno o bloqueado). Descargá una copia de seguridad.', 'error');
    }
    return;
  }
  lastSaved.set(id, text);
  saveState.value = 'saved';
  requestPersistence();
  const prev = spaces.value.find((m) => m.id === id);
  const meta = metaFor(id, text, prev);
  spaces.value = prev ? spaces.value.map((m) => (m.id === id ? meta : m)) : [meta, ...spaces.value];
}

function flushSave() {
  clearTimeout(saveTimer);
  pendingSave?.();
  pendingSave = null;
}

effect(() => {
  const text = source.value;
  const id = currentSpaceId.peek();
  clearTimeout(saveTimer);
  if (lastSaved.get(id) !== text) saveState.value = 'saving';
  pendingSave = () => saveNow(id, text);
  saveTimer = setTimeout(flushSave, 300);
});
effect(() => {
  lsSet(LS_INDEX, JSON.stringify(spaces.value));
});
effect(() => {
  lsSet(LS_CURRENT, currentSpaceId.value);
});
effect(() => {
  const v = activeView.value;
  const id = currentSpaceId.peek();
  const cur = spaces.peek().find((m) => m.id === id);
  if (cur && cur.view !== v) spaces.value = spaces.peek().map((m) => (m.id === id ? { ...m, view: v } : m));
});
effect(() => {
  document.documentElement.dataset.theme = theme.value;
  lsSet(LS_THEME, theme.value);
});
effect(() => {
  lsSet(LS_EDITOR, editorOpen.value ? 'open' : 'closed');
});
effect(() => {
  lsSet(LS_DOCK, dockOpen.value ? 'open' : 'closed');
});
if (typeof window !== 'undefined') {
  // Guardar ya mismo al cerrar, recargar o cambiar de pestaña/aplicación
  window.addEventListener('beforeunload', flushSave);
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());

  // Varias pestañas abiertas: mantener los espacios sincronizados
  window.addEventListener('storage', (e) => {
    if (e.key === LS_INDEX && e.newValue) {
      try {
        const remote = JSON.parse(e.newValue) as SpaceMeta[];
        if (Array.isArray(remote)) spaces.value = remote;
      } catch { /* índice inválido: se ignora */ }
      return;
    }
    if (e.key === spaceKey(currentSpaceId.value) && e.newValue !== null && e.newValue !== source.value) {
      // Si acá no hay cambios sin guardar, tomar la versión de la otra pestaña (deshacer sigue funcionando)
      if (lastSaved.get(currentSpaceId.value) === source.value) {
        lastSaved.set(currentSpaceId.value, e.newValue);
        applyText(e.newValue);
        toast('Actualizado con los cambios de otra pestaña');
      }
    }
  });
}

export function shareUrl(): string {
  const code = compressToEncodedURIComponent(source.value);
  return `${location.origin}${location.pathname}#code=${code}`;
}

// ---------------------------------------------------------------------------
// Edición: todo cambio pasa por el editor para que deshacer/rehacer sea uno solo
// ---------------------------------------------------------------------------

let editorView: EditorView | null = null;
let editorReset: ((text: string) => void) | null = null;
export function registerEditor(v: EditorView | null, reset: ((text: string) => void) | null = null) {
  editorView = v;
  editorReset = reset;
}
export function getEditor() {
  return editorView;
}

/** Diferencia mínima entre dos textos como un único reemplazo. */
export function textDiff(a: string, b: string) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

export function applyText(next: string) {
  const prev = source.value;
  if (prev === next) return;
  const selLine = selectedTask.value?.line;
  if (editorView) {
    editorView.dispatch({ changes: textDiff(prev, next), userEvent: 'input.ui' });
  } else {
    source.value = next;
  }
  // Si la tarea seleccionada cambió de clave (p. ej. al renombrarla), seguirla por su línea
  if (selectedKey.value && !doc.value.tasks.some((t) => t.key === selectedKey.value)) {
    const same = selLine !== undefined ? doc.value.tasks.find((t) => t.line === selLine) : undefined;
    selectedKey.value = same?.key ?? null;
  }
}

/** Aplica una operación del writer sobre el texto y el documento actuales. */
export function edit(fn: (text: string, d: GanttDoc) => string) {
  try {
    applyText(fn(source.value, doc.value));
  } catch (e) {
    console.error(e);
    toast('No se pudo aplicar el cambio', 'error');
  }
}

export function replaceAll(text: string) {
  applyText(normalize(text));
}

export function undo() {
  if (editorView) cmUndo(editorView);
}
export function redo() {
  if (editorView) cmRedo(editorView);
}

// ---------------------------------------------------------------------------
// Acciones sobre espacios
// ---------------------------------------------------------------------------

function loadIntoEditor(text: string) {
  if (editorReset) editorReset(text); // estado nuevo: el historial de deshacer no cruza espacios
  source.value = text;
}

export function switchSpace(id: string) {
  if (id === currentSpaceId.value) return;
  flushSave();
  const meta = spaces.value.find((m) => m.id === id);
  if (!meta) return;
  const text = normalize(lsGet(spaceKey(id)) ?? '');
  lastSaved.set(id, text);
  currentSpaceId.value = id;
  selectedKey.value = null;
  inspectorOpen.value = false;
  collapsed.value = new Set();
  quickFilter.value = { ...EMPTY_QUICK, mode: quickFilter.value.mode };
  zoom.value = 1;
  activeView.value = meta.view;
  loadIntoEditor(text);
}

export function createSpace(text: string, opts: { title?: string } = {}): string {
  flushSave();
  let t = normalize(text);
  if (opts.title) t = setTitle(t, parse(t), opts.title);
  const id = newId();
  lsSet(spaceKey(id), t);
  lastSaved.set(id, t);
  spaces.value = [metaFor(id, t), ...spaces.value];
  switchSpace(id);
  return id;
}

function uniqueTitle(base: string): string {
  const used = new Set(spaces.value.map((m) => m.title.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export function spaceText(id: string): string {
  if (id === currentSpaceId.value) return source.value;
  return normalize(lsGet(spaceKey(id)) ?? '');
}

export function duplicateSpace(id: string) {
  const text = spaceText(id);
  const title = uniqueTitle(`${parse(text).title || 'Sin título'} (copia)`);
  createSpace(text, { title });
  toast(`Espacio duplicado: ${title}`, 'success');
}

export function renameSpace(id: string, title: string) {
  const clean = title.trim();
  if (!clean) return;
  if (id === currentSpaceId.value) {
    edit((text, d) => setTitle(text, d, clean));
    return;
  }
  const text = spaceText(id);
  const next = setTitle(text, parse(text), clean);
  lsSet(spaceKey(id), next);
  lastSaved.set(id, next);
  spaces.value = spaces.value.map((m) => (m.id === id ? { ...metaFor(id, next, m), updated: m.updated } : m));
}

export function deleteSpace(id: string) {
  flushSave();
  const meta = spaces.value.find((m) => m.id === id);
  if (!meta) return;
  const text = spaceText(id);
  const wasCurrent = id === currentSpaceId.value;
  if (wasCurrent) {
    const others = spaces.value.filter((m) => m.id !== id).sort((a, b) => b.updated - a.updated);
    if (others.length) switchSpace(others[0].id);
    else createSpace(SAMPLE);
  }
  spaces.value = spaces.value.filter((m) => m.id !== id);
  lsDel(spaceKey(id));
  lastSaved.delete(id);
  toast(`"${meta.title}" eliminado`, 'info', {
    label: 'Deshacer',
    run: () => {
      lsSet(spaceKey(id), text);
      lastSaved.set(id, text);
      spaces.value = [meta, ...spaces.value.filter((m) => m.id !== id)];
      if (wasCurrent) switchSpace(id);
    },
  });
}

export { uniqueTitle as uniqueSpaceTitle };

// ---------------------------------------------------------------------------
// Copia de seguridad de todos los espacios
// ---------------------------------------------------------------------------

interface Backup {
  app: 'ganttmaker';
  version: 1;
  exported: string;
  spaces: { title: string; text: string; view: string | null }[];
}

export function exportSpaces(): string {
  flushSave();
  const data: Backup = {
    app: 'ganttmaker',
    version: 1,
    exported: new Date().toISOString(),
    spaces: [...spaces.value]
      .sort((a, b) => b.updated - a.updated)
      .map((m) => ({ title: m.title, text: spaceText(m.id), view: m.view })),
  };
  return JSON.stringify(data, null, 2);
}

/** Importa una copia de seguridad: cada espacio entra como uno nuevo. Devuelve cuántos. */
export function importSpaces(json: string): number {
  const data = JSON.parse(json) as Backup;
  if (data?.app !== 'ganttmaker' || !Array.isArray(data.spaces)) throw new Error('Formato inválido');
  flushSave();
  const created: SpaceMeta[] = [];
  for (const s of data.spaces) {
    if (typeof s.text !== 'string') continue;
    const id = newId();
    const text = normalize(s.text);
    lsSet(spaceKey(id), text);
    lastSaved.set(id, text);
    created.push({ ...metaFor(id, text), view: s.view ?? null });
  }
  spaces.value = [...created, ...spaces.value];
  if (created[0]) switchSpace(created[0].id);
  return created.length;
}
