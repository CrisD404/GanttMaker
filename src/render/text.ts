let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** Ancho aproximado de un texto en píxeles (para decidir si una etiqueta entra en la barra). */
export function textWidth(text: string, font = '500 11.5px Inter, system-ui, sans-serif'): number {
  const k = font + '|' + text;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  if (!ctx && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  let w = text.length * 6.5;
  if (ctx) {
    ctx.font = font;
    w = ctx.measureText(text).width;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, w);
  return w;
}

export function truncate(text: string, maxWidth: number, font?: string): string {
  if (textWidth(text, font) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(text.slice(0, mid) + '…', font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}
