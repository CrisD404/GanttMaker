import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { contextMenu, type MenuEntry } from '../state/store';
import { Floating, FLOATING_ATTR, type Placement } from './floating';
import { Icon } from './icons';

/** Monta el menú contextual global (cualquier componente lo abre con `openContextMenu`). */
export function ContextMenuHost() {
  const m = contextMenu.value;
  if (!m) return null;
  return <ContextMenu key={`${m.x},${m.y}`} x={m.x} y={m.y} items={m.items} onClose={() => (contextMenu.value = null)} />;
}

/** Control segmentado con indicador que se desliza hacia la opción activa. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  title,
}: {
  options: { value: T; label: ComponentChildren; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button.on');
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
    else setInd(null);
  }, [value, options.length]);

  return (
    <div class="seg" ref={ref} role="radiogroup" title={title}>
      {ind && <div class="seg-indicator" style={{ left: ind.left, width: ind.width }} />}
      {options.map((o) => (
        <button
          key={String(o.value)}
          class={o.value === value ? 'on' : ''}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button class={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/**
 * Botón que abre un panel flotante (en <body>, nunca recortado); se cierra al hacer clic
 * afuera o con Escape. `placement="top"` lo abre hacia arriba (p. ej. desde el dock).
 */
export function Popover({
  trigger,
  children,
  align = 'right',
  placement = 'bottom',
}: {
  trigger: (open: boolean, toggle: () => void) => ComponentChildren;
  children: (close: () => void) => ComponentChildren;
  align?: 'left' | 'right';
  placement?: Placement;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  return (
    <div class="popover-wrap" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      <Floating anchor={ref} open={open} onClose={close} placement={placement} align={align === 'right' ? 'end' : 'start'} className="popover">
        {children(close)}
      </Floating>
    </div>
  );
}

export type { MenuEntry };

export function MenuItems({ items, close }: { items: MenuEntry[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.separator) return <div class="menu-sep" key={i} />;
        if (it.heading) return <div class="menu-title" key={i}>{it.heading}</div>;
        if (it.custom) return <div key={i}>{it.custom(close)}</div>;
        return (
          <button
            key={i}
            class={`menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked}
            onClick={() => {
              close();
              it.onClick?.();
            }}
          >
            {it.checked !== undefined ? (
              <span class={`menu-check ${it.checked ? 'on' : ''}`}><Icon name="check" size={12} /></span>
            ) : (
              it.icon
            )}
            {it.label}
            {it.hint && <span class="hint">{it.hint}</span>}
          </button>
        );
      })}
    </>
  );
}

/** Menú contextual en la posición del puntero. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // Un calendario o lista abiertos desde el menú (capas flotantes) no lo cierran
      if ((e.target as Element).closest?.(`[${FLOATING_ATTR}]`)) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div class="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={items} close={onClose} />
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}
