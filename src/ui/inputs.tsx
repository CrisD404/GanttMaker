// Controles de formulario propios (reemplazan <select>, <input type="date"> y <datalist>,
// que el navegador dibuja con su estilo nativo y no respetan el tema de la app).
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addMonths, formatMedium, fromYmd, isWorkday, monthLong, parseIso, startOfMonth, startOfWeek, toIso, todayDay, ymd,
  type Calendar, type Day,
} from '../core/dates';
import { Floating } from './floating';
import { Icon } from './icons';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Input que toma el foco al montarse (autoFocus no es confiable en elementos insertados dinámicamente). */
function FocusedInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return <input ref={ref} {...props} />;
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export interface SelectOption<T> {
  value: T;
  label: string;
  group?: string;
  icon?: ComponentChildren;
  hint?: string;
  /** Sangría (p. ej. subtareas). */
  depth?: number;
}

export function Select<T>({
  value,
  options,
  onChange,
  placeholder = 'Elegí…',
  searchable,
  className = '',
  triggerLabel,
  title,
}: {
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  /** Contenido fijo del botón (si no, se muestra la opción elegida). */
  triggerLabel?: ComponentChildren;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showSearch = searchable ?? options.length > 9;

  const filtered = useMemo(() => {
    const f = fold(q.trim());
    return f ? options.filter((o) => fold(`${o.label} ${o.group ?? ''}`).includes(f)) : options;
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    const i = options.findIndex((o) => o.value === value);
    setActive(Math.max(0, i));
  }, [open]);

  useLayoutEffect(() => {
    listRef.current?.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (o: SelectOption<T> | undefined) => {
    if (!o) return;
    setOpen(false);
    onChange(o.value);
    anchor.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[active]); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(filtered.length - 1); }
  };

  const current = options.find((o) => o.value === value);
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        class={`input select-trigger ${open ? 'open' : ''} ${className}`}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          } else if (open) onKey(e);
        }}
      >
        <span class={`select-value ${current || triggerLabel ? '' : 'placeholder'}`}>
          {triggerLabel ?? (current ? <>{current.icon}{current.label}</> : placeholder)}
        </span>
        <Icon name="chevronDown" size={14} class="select-chev" />
      </button>
      <Floating anchor={anchor} open={open} onClose={() => setOpen(false)} matchWidth className="select-panel" keepFocus={!showSearch}>
        {showSearch && (
          <label class="select-search">
            <Icon name="search" size={13} />
            <FocusedInput
              placeholder="Buscar…"
              value={q}
              onInput={(e) => { setQ((e.target as HTMLInputElement).value); setActive(0); }}
              onKeyDown={(e) => { e.stopPropagation(); onKey(e); if (e.key === 'Escape') setOpen(false); }}
            />
          </label>
        )}
        <div class="select-list" role="listbox" ref={listRef}>
          {filtered.map((o, i) => {
            const header = o.group !== undefined && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={i}>
                {header !== null && <div class="opt-group">{header || '—'}</div>}
                <div
                  class={`opt ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
                  role="option"
                  aria-selected={o.value === value}
                  style={{ paddingLeft: 10 + (o.depth ?? 0) * 14 }}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                >
                  {o.icon}
                  <span class="opt-label">{o.label}</span>
                  {o.hint && <span class="opt-hint">{o.hint}</span>}
                  {o.value === value && <Icon name="check" size={13} class="opt-check" />}
                </div>
              </div>
            );
          })}
          {!filtered.length && <div class="opt-empty">Sin resultados</div>}
        </div>
      </Floating>
    </>
  );
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Acepta 2026-10-19, 19/10/2026, 19-10-2026 y 19/10 (año actual). */
export function parseLooseDate(s: string): Day | null {
  const t = s.trim();
  const iso = parseIso(t);
  if (iso !== null) return iso;
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ymd(todayDay()).y;
  const d = fromYmd(y, +m[2] - 1, +m[1]);
  return ymd(d).d === +m[1] ? d : null;
}

function CalendarPanel({ value, onPick, calendar }: { value: Day | null; onPick: (d: Day) => void; calendar?: Calendar }) {
  const today = todayDay();
  const [month, setMonth] = useState(startOfMonth(value ?? today));
  const [focus, setFocus] = useState(value ?? today);
  const [typed, setTyped] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gridRef.current?.focus({ preventScroll: true });
  }, []);

  const moveFocus = (d: Day) => {
    setFocus(d);
    if (d < month || d >= addMonths(month, 1)) setMonth(startOfMonth(d));
  };

  const first = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => first + i);
  const { y, m } = ymd(month);
  const typedDay = typed ? parseLooseDate(typed) : null;

  return (
    <div class="calendar">
      <div class="cal-head">
        <button type="button" class="icon-btn sm" title="Mes anterior (RePág)" onClick={() => setMonth(addMonths(month, -1))}>
          <Icon name="chevronDown" size={15} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <span class="cal-title" key={month}>{monthLong(m)} {y}</span>
        <button type="button" class="icon-btn sm" title="Mes siguiente (AvPág)" onClick={() => setMonth(addMonths(month, 1))}>
          <Icon name="chevronDown" size={15} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>
      <div
        class="cal-grid"
        tabIndex={0}
        ref={gridRef}
        onKeyDown={(e) => {
          const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (map[e.key] !== undefined) { e.preventDefault(); moveFocus(focus + map[e.key]); }
          else if (e.key === 'PageUp') { e.preventDefault(); moveFocus(addMonths(focus, -1)); }
          else if (e.key === 'PageDown') { e.preventDefault(); moveFocus(addMonths(focus, 1)); }
          else if (e.key === 'Home') { e.preventDefault(); moveFocus(today); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(focus); }
        }}
      >
        {WEEKDAYS.map((w) => <span key={w} class="cal-wd">{w}</span>)}
        {days.map((d) => {
          const cls = [
            'cal-day',
            d < month || d >= addMonths(month, 1) ? 'other' : '',
            d === today ? 'today' : '',
            d === value ? 'selected' : '',
            d === focus ? 'focus' : '',
            calendar && !isWorkday(calendar, d) ? 'off' : '',
          ].join(' ');
          return (
            <button type="button" key={d} class={cls} tabIndex={-1} onClick={() => onPick(d)} title={formatMedium(d)}>
              {ymd(d).d}
            </button>
          );
        })}
      </div>
      <div class="cal-foot">
        <input
          class={`cal-typed ${typed && typedDay === null ? 'invalid' : ''}`}
          placeholder="dd/mm/aaaa"
          value={typed}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setTyped(v);
            const d = parseLooseDate(v);
            if (d !== null) moveFocus(d);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && typedDay !== null) onPick(typedDay);
          }}
        />
        <button type="button" class="btn sm ghost" onClick={() => onPick(today)}>Hoy</button>
      </div>
    </div>
  );
}

/** Campo de fecha con calendario propio. `value` y `onChange` usan ISO (AAAA-MM-DD). */
export function DateInput({
  value,
  onChange,
  calendar,
  autoOpen = false,
  onDone,
  disabled,
  className = '',
}: {
  value: string | null;
  onChange: (iso: string) => void;
  calendar?: Calendar;
  autoOpen?: boolean;
  /** Se llama al cerrar el calendario (elegida o no). Útil para la edición en línea. */
  onDone?: (picked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(autoOpen);
  const anchor = useRef<HTMLButtonElement>(null);
  const day = value ? parseIso(value) : null;
  const close = (picked: boolean) => {
    setOpen(false);
    onDone?.(picked);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        class={`input date-trigger ${open ? 'open' : ''} ${className}`}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="calendar" size={14} />
        <span>{day !== null ? formatMedium(day) : '—'}</span>
      </button>
      <Floating anchor={anchor} open={open && !disabled} onClose={() => close(false)} className="date-panel">
        <CalendarPanel
          value={day}
          calendar={calendar}
          onPick={(d) => {
            onChange(toIso(d));
            close(true);
            anchor.current?.focus();
          }}
        />
      </Floating>
    </>
  );
}

// ---------------------------------------------------------------------------
// Autocompletar
// ---------------------------------------------------------------------------

export interface Suggestion {
  value: string;
  label?: string;
  hint?: string;
  icon?: ComponentChildren;
}

/**
 * Input con sugerencias propias. Con `multiple`, el texto es una lista separada por comas y
 * las sugerencias completan el último elemento.
 */
export function Autocomplete({
  value: initial = '',
  suggestions,
  onSubmit,
  onCancel,
  onBlurValue,
  placeholder,
  className = 'chip-input',
  autoFocus = false,
  multiple = false,
  clearOnSubmit = false,
}: {
  value?: string;
  suggestions: Suggestion[];
  onSubmit: (v: string) => void;
  onCancel?: () => void;
  /** Al perder el foco (sin Enter). */
  onBlurValue?: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  multiple?: boolean;
  clearOnSubmit?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const tokens = multiple ? text.split(',') : [text];
  const last = tokens[tokens.length - 1].trim().replace(/^@/, '');
  const taken = new Set(multiple ? tokens.slice(0, -1).map((t) => fold(t.trim())) : []);
  const list = suggestions
    .filter((s) => !taken.has(fold(s.value)))
    .filter((s) => !last || fold(s.value).includes(fold(last)))
    .slice(0, 8);

  const apply = (s: Suggestion) => {
    if (multiple) {
      const next = [...tokens.slice(0, -1).map((t) => t.trim()).filter(Boolean), s.value].join(', ');
      setText(next + ', ');
      setActive(-1);
    } else {
      submit(s.value);
    }
  };
  const submit = (v: string) => {
    done.current = true;
    setOpen(false);
    onSubmit(multiple ? v.replace(/,\s*$/, '') : v);
    if (clearOnSubmit) {
      setText('');
      done.current = false;
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        class={className}
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onInput={(e) => {
          setText((e.target as HTMLInputElement).value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(list.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
          else if ((e.key === 'Enter' || e.key === 'Tab') && open && active >= 0 && list[active] && last) {
            e.preventDefault();
            apply(list[active]);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit(text.trim());
          } else if (e.key === 'Escape') {
            if (open && list.length) setOpen(false);
            else { done.current = true; onCancel?.(); }
          }
        }}
        onBlur={() => {
          setOpen(false);
          if (!done.current) onBlurValue?.(text.trim());
        }}
      />
      <Floating anchor={inputRef} open={open && list.length > 0} onClose={() => setOpen(false)} className="select-panel" keepFocus>
        <div class="select-list" role="listbox">
          {list.map((s, i) => (
            <div
              key={s.value}
              class={`opt ${i === active ? 'active' : ''}`}
              role="option"
              onPointerEnter={() => setActive(i)}
              onClick={() => apply(s)}
            >
              {s.icon}
              <span class="opt-label">{s.label ?? s.value}</span>
              {s.hint && <span class="opt-hint">{s.hint}</span>}
            </div>
          ))}
        </div>
      </Floating>
    </>
  );
}
