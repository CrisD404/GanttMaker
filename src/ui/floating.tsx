// Paneles flotantes (popovers, listas, calendarios) renderizados en <body> con posición fija:
// nunca quedan recortados por contenedores con scroll y se dan vuelta si no hay espacio.
import type { ComponentChildren, RefObject } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

export type Placement = 'bottom' | 'top' | 'auto';
export type Align = 'start' | 'end';

/** Atributo que marca una capa flotante. */
export const FLOATING_ATTR = 'data-floating';

let openCounter = 0;

/** Orden de apertura de la capa que contiene al elemento (Infinity para menús contextuales). */
function layerOrder(target: EventTarget | null): number | null {
  const el = target as Element | null;
  if (!el?.closest) return null;
  if (el.closest('.context-menu')) return Infinity;
  const layer = el.closest(`[${FLOATING_ATTR}]`) as HTMLElement | null;
  return layer ? Number(layer.dataset.order ?? 0) : null;
}

/**
 * ¿El clic cae en una capa abierta *después* de la capa `order`? (un calendario dentro de un
 * popover, un menú contextual…). En ese caso la capa de abajo no debe cerrarse.
 */
export function isInLayerAbove(target: EventTarget | null, order: number): boolean {
  const o = layerOrder(target);
  return o !== null && o > order;
}

const GAP = 6;
const MARGIN = 8;

function position(anchor: HTMLElement, panel: HTMLElement, placement: Placement, align: Align, matchWidth: boolean) {
  const r = anchor.getBoundingClientRect();
  if (matchWidth) panel.style.minWidth = `${r.width}px`;
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const below = window.innerHeight - r.bottom - MARGIN;
  const above = r.top - MARGIN;
  const up =
    placement === 'top' ? above >= ph || above > below
      : placement === 'bottom' ? below < ph && above > below + 40
        : below < ph && above > below;
  let top = up ? r.top - GAP - ph : r.bottom + GAP;
  top = Math.max(MARGIN, Math.min(top, window.innerHeight - ph - MARGIN));
  let left = align === 'end' ? r.right - pw : r.left;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - pw - MARGIN));
  panel.style.top = `${Math.round(top)}px`;
  panel.style.left = `${Math.round(left)}px`;
  panel.style.transformOrigin = `${align === 'end' ? 'right' : 'left'} ${up ? 'bottom' : 'top'}`;
  panel.dataset.side = up ? 'top' : 'bottom';
}

export function Floating({
  anchor,
  open,
  onClose,
  children,
  placement = 'auto',
  align = 'start',
  matchWidth = false,
  className = '',
  keepFocus = false,
}: {
  anchor: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  placement?: Placement;
  align?: Align;
  matchWidth?: boolean;
  className?: string;
  /** El panel no roba el foco al hacer clic (para listas/calendarios asociados a un input). */
  keepFocus?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const order = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    order.current = ++openCounter;
    panel.current.dataset.order = String(order.current);
    const place = () => anchor.current && panel.current && position(anchor.current, panel.current, placement, align, matchWidth);
    place();
    // Reubicar si cambia el tamaño del panel (p. ej. al filtrar una lista) o se desplaza la página
    const ro = new ResizeObserver(place);
    ro.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      if (isInLayerAbove(e.target, order.current)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Solo la capa de más arriba responde al Escape
      const top = Math.max(...[...document.querySelectorAll<HTMLElement>(`[${FLOATING_ATTR}]`)].map((el) => Number(el.dataset.order ?? 0)));
      if (order.current < top) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      class={`floating ${className}`}
      {...{ [FLOATING_ATTR]: '' }}
      style={{ top: -9999, left: -9999 }}
      onPointerDown={keepFocus ? (e) => { if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault(); } : undefined}
    >
      {children}
    </div>,
    document.body,
  );
}
