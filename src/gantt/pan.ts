// Estado compartido del "arrastrar para desplazar" (pan): permite ignorar el doble clic que
// queda registrado justo después de soltar un arrastre.
export const panInfo = { lastPanEnd: 0 };

export function panJustEnded(ms = 450): boolean {
  return performance.now() - panInfo.lastPanEnd < ms;
}

/** Zonas donde el clic tiene otra función: ahí no se empieza a desplazar con el botón izquierdo. */
export const NOT_PANNABLE =
  '.bar-row, .dep-group, .avatar-hit, .grid-row, .corner, input, button, textarea, select, .chart-rename, .filter-dock, [data-floating], .context-menu';
