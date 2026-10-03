import { countWorkdays, formatShort } from '../core/dates';
import type { GanttDoc, ViewSettings } from '../core/types';
import { computeLayout, type Layout } from '../render/layout';
import { depRoute } from '../render/paths';
import { textWidth, truncate } from '../render/text';

const THEMES = {
  light: {
    bg: '#ffffff', text: '#191d2b', muted: '#5b6276', faint: '#9ca2b5', grid: '#eef0f5', gridStrong: '#e1e4ec',
    weekend: 'rgba(30,41,80,0.035)', band: 'rgba(30,41,80,0.03)', today: '#e5484d', danger: '#e5484d', border: '#e5e7ef',
  },
  dark: {
    bg: '#14171f', text: '#e8eaf3', muted: '#a3a9be', faint: '#6a718a', grid: '#1c202c', gridStrong: '#262b3a',
    weekend: 'rgba(255,255,255,0.022)', band: 'rgba(255,255,255,0.025)', today: '#ff6369', danger: '#ff6369', border: '#262b3b',
  },
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ExportOptions {
  doc: GanttDoc;
  settings: ViewSettings;
  collapsed: Set<string>;
  zoom: number;
  today: number;
  theme: 'light' | 'dark';
  viewName: string | null;
  /** Solo el gráfico (sin título ni columnas): para vistas previas. */
  compact?: boolean;
}

/** Genera un SVG autocontenido de la vista actual (grilla + gráfico). */
export function exportSvg(o: ExportOptions): { svg: string; width: number; height: number } {
  const L: Layout = computeLayout({ doc: o.doc, settings: o.settings, collapsed: o.collapsed, zoom: o.zoom, today: o.today, minChartWidth: 0 });
  const c = THEMES[o.theme];
  const titleH = o.compact ? 0 : 56;
  const cols = o.compact ? [] : L.columns;
  const gx = o.compact ? 0 : L.gridW;
  const W = gx + L.width;
  const H = titleH + L.headerH + L.height + 12;
  const gy = titleH + L.headerH;
  const px = L.pxPerDay;
  const x = (d: number) => gx + (d - L.rangeStart) * px;
  const rowH = L.rowH;
  const barH = Math.round(rowH * 0.6);
  const parts: string[] = [];
  const p = (s: string) => parts.push(s);

  p(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`);
  p(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" fill="${c.faint}"/></marker></defs>`);
  p(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`);
  const title = o.doc.title || 'Gantt';
  if (!o.compact) {
    p(`<text x="16" y="34" font-size="18" font-weight="700" fill="${c.text}">${esc(title)}</text>`);
    if (o.viewName) p(`<text x="${22 + textWidth(title, '700 18px Inter')}" y="34" font-size="13" fill="${c.faint}">· ${esc(o.viewName)}</text>`);
  }

  // Encabezado
  const hy = titleH;
  p(`<line x1="0" x2="${W}" y1="${hy + 24.5}" y2="${hy + 24.5}" stroke="${c.gridStrong}"/>`);
  p(`<line x1="0" x2="${W}" y1="${gy - 0.5}" y2="${gy - 0.5}" stroke="${c.border}"/>`);
  for (const t of L.top) {
    p(`<line x1="${gx + t.x}" x2="${gx + t.x}" y1="${hy}" y2="${gy + L.height}" stroke="${c.gridStrong}"/>`);
    const label = truncate(t.label, t.w - 14, '600 11px Inter');
    if (label) p(`<text x="${gx + t.x + 8}" y="${hy + 16}" font-size="11" font-weight="600" fill="${c.text}">${esc(label)}</text>`);
  }
  for (const t of L.bottom) {
    if (o.settings.features.grid) p(`<line x1="${gx + t.x}" x2="${gx + t.x}" y1="${hy + 24}" y2="${gy + L.height}" stroke="${c.grid}"/>`);
    if (textWidth(t.label, '400 11px Inter') + 6 <= t.w) {
      p(`<text x="${gx + t.x + t.w / 2}" y="${hy + 44}" font-size="11" text-anchor="middle" fill="${c.muted}">${esc(t.label)}</text>`);
    }
  }
  // Columnas
  let cx = 0;
  for (const col of cols) {
    p(`<text x="${cx + (col.key === 'name' ? 16 : 10)}" y="${hy + 44}" font-size="10.5" font-weight="600" fill="${c.faint}" letter-spacing="0.4">${esc(col.label.toUpperCase())}</text>`);
    cx += col.width;
  }
  if (!o.compact) p(`<line x1="${gx - 0.5}" x2="${gx - 0.5}" y1="${hy}" y2="${gy + L.height}" stroke="${c.border}"/>`);

  // Fondo de filas
  for (const n of L.nonWorking) p(`<rect x="${gx + n.x}" y="${gy}" width="${n.w}" height="${L.height}" fill="${c.weekend}"/>`);
  for (const r of L.rows) {
    if (r.kind === 'section') p(`<rect x="0" y="${gy + r.y}" width="${W}" height="${rowH}" fill="${c.band}"/>`);
    if (o.settings.features.grid) p(`<line x1="0" x2="${W}" y1="${gy + r.y + rowH - 0.5}" y2="${gy + r.y + rowH - 0.5}" stroke="${c.grid}"/>`);
  }

  // Grilla de texto
  for (const r of L.rows) {
    const cy = gy + r.y + rowH / 2 + 4;
    let colX = 0;
    for (const col of cols) {
      let text = '';
      let anchor = 'start';
      let tx = colX + 10;
      let weight = 400;
      let fill = c.muted;
      if (col.key === 'name') {
        const indent = r.kind === 'section' ? 0 : (r.depth + (r.section.line >= 0 ? 1 : 0)) * 16;
        tx = colX + 16 + indent;
        text = truncate(r.label, col.width - 24 - indent, '500 12.5px Inter');
        weight = r.kind === 'section' || r.hasChildren ? 600 : 400;
        fill = c.text;
      } else if (col.key === 'owner') {
        text = r.task?.spec.owners.join(', ') ?? '';
        text = truncate(text, col.width - 16, '400 12px Inter');
      } else {
        anchor = 'end';
        tx = colX + col.width - 10;
        if (col.key === 'start') text = formatShort(r.start);
        if (col.key === 'end') text = formatShort(r.task?.spec.milestone ? r.start : r.end - 1);
        if (col.key === 'duration') text = r.task?.spec.milestone ? '◆' : `${countWorkdays(o.doc.calendar, r.start, r.end)}d`;
        if (col.key === 'progress' && r.task?.spec.progress !== undefined) text = `${r.task.spec.progress}%`;
      }
      if (text) p(`<text x="${tx}" y="${cy}" font-size="${col.key === 'name' ? 12.5 : 12}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`);
      colX += col.width;
    }
  }

  // Dependencias
  for (const dep of L.deps) {
    const fromMs = !!dep.from.task?.spec.milestone;
    const toMs = !!dep.to.task?.spec.milestone;
    const x1 = fromMs ? x(dep.from.start) + barH / 2 + 1 : x(dep.from.end);
    const y1 = gy + dep.from.y + rowH / 2;
    const x2 = toMs ? x(dep.to.start) - barH / 2 - 3 : x(dep.to.start) - 2;
    const y2 = gy + dep.to.y + rowH / 2;
    // Misma ruta redondeada que en la app
    const { d } = depRoute({ x1, y1, x2, y2, toRowTop: gy + dep.to.y, rowH });
    p(`<path d="${d}" fill="none" stroke="${dep.critical ? c.danger : c.faint}" stroke-width="1.5" stroke-linejoin="round" marker-end="url(#a)"/>`);
  }

  // Barras
  for (const r of L.rows) {
    const t = r.task;
    const bx = x(r.start);
    const cy = gy + r.y + rowH / 2;
    const w = Math.max(3, (r.end - r.start) * px);
    if (t?.spec.milestone) {
      const s = barH * 0.5;
      p(`<rect x="${bx - s}" y="${cy - s}" width="${barH}" height="${barH}" rx="2.5" fill="${t.spec.color ?? (t.critical ? c.danger : c.text)}" transform="rotate(45 ${bx} ${cy})"/>`);
      if (o.settings.features.labels) p(`<text x="${bx + s + 10}" y="${cy + 4}" font-size="11.5" font-weight="600" fill="${c.text}">${esc(r.label)}</text>`);
      continue;
    }
    if (r.kind === 'section' || (t && t.children.length)) {
      const h = r.kind === 'section' ? 10 : 8;
      p(`<rect x="${bx}" y="${cy - h / 2}" width="${w}" height="${h}" rx="2" fill="${r.color}" opacity="0.8"/>`);
      p(`<path d="M${bx} ${cy + h / 2}l0 5l5 -5z M${bx + w} ${cy + h / 2}l0 5l-5 -5z" fill="${r.color}" opacity="0.8"/>`);
      for (const m of r.innerMilestones) {
        const mx = x(m.day);
        p(`<rect x="${mx - 5}" y="${cy - 5}" width="10" height="10" rx="1.5" fill="${c.text}" transform="rotate(45 ${mx} ${cy})"/>`);
      }
      if (o.settings.features.labels) p(`<text x="${bx + w + 10}" y="${cy + 4}" font-size="11.5" font-weight="600" fill="${c.text}">${esc(r.label)}</text>`);
      continue;
    }
    if (!t) continue;
    const top = cy - barH / 2;
    const rx = Math.min(6, barH / 2.5);
    const prog = o.settings.features.progress ? t.spec.progress : undefined;
    if (prog !== undefined) {
      p(`<rect x="${bx}" y="${top}" width="${w}" height="${barH}" rx="${rx}" fill="${r.color}" opacity="0.28"/>`);
      p(`<rect x="${bx}" y="${top}" width="${(w * prog) / 100}" height="${barH}" rx="${rx}" fill="${r.color}"/>`);
    } else {
      p(`<rect x="${bx}" y="${top}" width="${w}" height="${barH}" rx="${rx}" fill="${r.color}" opacity="${t.status === 'done' ? 0.55 : 1}"/>`);
    }
    if (t.critical) p(`<rect x="${bx - 1}" y="${top - 1}" width="${w + 2}" height="${barH + 2}" rx="${rx + 1}" fill="none" stroke="${c.danger}" stroke-width="2"/>`);
    if (o.settings.features.labels) {
      const label = t.status === 'done' ? `✓ ${r.label}` : r.label;
      const lw = textWidth(label, '500 11.5px Inter');
      const inside = lw + 18 <= w;
      const fill = inside ? (prog !== undefined && prog < 40 ? c.text : '#ffffff') : c.text;
      p(`<text x="${inside ? bx + 9 : bx + w + 10}" y="${cy + 4}" font-size="11.5" font-weight="500" fill="${fill}">${esc(label)}</text>`);
    }
  }

  // Hoy
  if (o.settings.features.today && L.today >= L.rangeStart && L.today <= L.rangeEnd) {
    const tx = x(L.today);
    p(`<line x1="${tx}" x2="${tx}" y1="${hy + 24}" y2="${gy + L.height}" stroke="${c.today}" stroke-width="1.5"/>`);
  }
  p('</svg>');
  return { svg: parts.join(''), width: W, height: H };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text: string, filename: string, type = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo rasterizar el SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileSlug(title: string): string {
  return (title || 'gantt').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'gantt';
}
