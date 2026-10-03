// Trazado de las flechas de dependencia.
// Siempre se genera la MISMA estructura de comandos (M L Q L Q L Q L Q L) para que el
// navegador pueda interpolar `d` con CSS y la flecha se deslice cuando las barras se mueven.

type Pt = [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Polilínea con esquinas redondeadas (radio máximo `radius`). */
export function roundedPath(pts: Pt[], radius: number): string {
  const n = pts.length;
  let d = `M ${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    // El primer y el último tramo no comparten su largo con otra esquina
    const lim1 = i === 1 ? l1 : l1 / 2;
    const lim2 = i === n - 2 ? l2 : l2 / 2;
    const rr = Math.min(radius, lim1, lim2);
    const ax = l1 ? cx - ((cx - px) / l1) * rr : cx;
    const ay = l1 ? cy - ((cy - py) / l1) * rr : cy;
    const bx = l2 ? cx + ((nx - cx) / l2) * rr : cx;
    const by = l2 ? cy + ((ny - cy) / l2) * rr : cy;
    d += ` L ${r1(ax)} ${r1(ay)} Q ${r1(cx)} ${r1(cy)} ${r1(bx)} ${r1(by)}`;
  }
  return d + ` L ${r1(pts[n - 1][0])} ${r1(pts[n - 1][1])}`;
}

export interface DepGeometry {
  /** Fin del predecesor (punta de salida). */
  x1: number;
  y1: number;
  /** Inicio del sucesor (punta de la flecha). */
  x2: number;
  y2: number;
  /** Borde superior de la fila del sucesor y alto de fila: para el "carril" entre filas. */
  toRowTop: number;
  rowH: number;
}

export const DEP_OUT = 8;
export const DEP_IN = 12;
export const DEP_RADIUS = 6;

/**
 * Ruta de una dependencia fin→inicio:
 * - Si hay espacio: sale a la derecha, baja/sube y entra horizontal al sucesor.
 * - Si el sucesor empieza antes: rodea por el carril entre filas (forma de S).
 */
export function depRoute(g: DepGeometry): { d: string; mid: Pt } {
  const { x1, y1, x2, y2, toRowTop, rowH } = g;
  let pts: Pt[];
  let mid: Pt;
  if (x2 - x1 >= DEP_OUT + DEP_IN + DEP_RADIUS) {
    const xa = x1 + DEP_OUT;
    const xb = x2 - DEP_IN;
    pts = [[x1, y1], [xa, y1], [xa, y2], [xb, y2], [xb, y2], [x2, y2]];
    mid = [xa, (y1 + y2) / 2];
  } else {
    const lane = y2 > y1 ? toRowTop : toRowTop + rowH;
    const xa = x1 + DEP_OUT;
    const xb = x2 - DEP_IN;
    pts = [[x1, y1], [xa, y1], [xa, lane], [xb, lane], [xb, y2], [x2, y2]];
    mid = [(xa + xb) / 2, lane];
  }
  return { d: roundedPath(pts, DEP_RADIUS), mid };
}
