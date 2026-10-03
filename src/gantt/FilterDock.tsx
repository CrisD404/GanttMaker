import { useEffect, useRef, useState } from 'preact/hooks';
import type { Owner } from '../core/types';
import { quickActive } from '../render/layout';
import { clearQuickFilter, saveQuickFilterToView, setViewFilter, toggleQuickOwner, toggleQuickTag } from '../state/actions';
import { currentView, doc, dockOpen, inspectorOpen, quickFilter, settings } from '../state/store';
import { initials, Popover } from '../ui/controls';
import { Icon } from '../ui/icons';

const STATUS_CHIPS: { tag: string; label: string; color: string }[] = [
  { tag: 'crit', label: 'Críticas', color: 'var(--danger)' },
  { tag: 'active', label: 'En curso', color: 'var(--accent)' },
  { tag: 'blocked', label: 'Bloqueadas', color: 'var(--danger)' },
  { tag: 'done', label: 'Hechas', color: 'var(--success)' },
  { tag: 'milestone', label: 'Hitos', color: 'var(--text)' },
];
const RESERVED = new Set(['crit', 'active', 'blocked', 'done']);

const VISIBLE_OWNERS = 5;

function ownerTitle(o: Owner) {
  return `${o.name}${o.kind === 'team' ? ' (equipo: incluye a sus personas)' : o.team ? ` · ${o.team}` : ''}`;
}

/**
 * Avatares apilados (estilo Jira): se ven los primeros 5 y el resto queda en "+N",
 * que abre una lista con búsqueda. Los seleccionados ocultos se cuentan en el "+N".
 */
function OwnerStack({ selected }: { selected: string[] }) {
  const owners = [...doc.value.owners.values()];
  const isOn = (o: Owner) => selected.some((x) => x.toLowerCase() === o.name.toLowerCase());
  const visible = owners.slice(0, VISIBLE_OWNERS);
  const rest = owners.slice(VISIBLE_OWNERS);
  const restOn = rest.filter(isOn).length;
  if (!owners.length) return null;
  return (
    <div class="owner-stack" aria-label="Responsables">
      {visible.map((o, i) => (
        <button
          key={o.name}
          class={`dock-avatar ${isOn(o) ? 'on' : ''} ${o.kind === 'team' ? 'team' : ''}`}
          style={{ '--c': o.color, zIndex: VISIBLE_OWNERS - i } as Record<string, string | number>}
          onClick={() => toggleQuickOwner(o.name)}
          title={ownerTitle(o)}
        >
          {initials(o.name)}
        </button>
      ))}
      {rest.length > 0 && (
        <Popover
          placement="top"
          align="left"
          trigger={(open, toggle) => (
            <button class={`dock-avatar more ${open ? 'open' : ''} ${restOn ? 'on' : ''}`} onClick={toggle} title={`${rest.length} responsables más`}>
              +{rest.length}
              {restOn > 0 && <span class="more-badge">{restOn}</span>}
            </button>
          )}
        >
          {() => <OwnerList owners={owners} isOn={isOn} />}
        </Popover>
      )}
    </div>
  );
}

function OwnerList({ owners, isOn }: { owners: Owner[]; isOn: (o: Owner) => boolean }) {
  const [q, setQ] = useState('');
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = owners.filter((o) => !q || fold(`${o.name} ${o.team ?? ''}`).includes(fold(q)));
  const teams = list.filter((o) => o.kind === 'team');
  const people = list.filter((o) => o.kind === 'person');
  const row = (o: Owner) => (
    <button key={o.name} class={`owner-row ${isOn(o) ? 'on' : ''}`} onClick={() => toggleQuickOwner(o.name)} title={ownerTitle(o)}>
      <span class={`menu-check ${isOn(o) ? 'on' : ''}`}><Icon name="check" size={12} /></span>
      <span class={`avatar ${o.kind === 'team' ? 'team' : ''}`} style={{ background: o.color }}>{initials(o.name)}</span>
      <span class="owner-row-name">{o.name}</span>
      {o.team && <span class="opt-hint">{o.team}</span>}
    </button>
  );
  return (
    <div class="owner-list">
      <label class="select-search">
        <Icon name="search" size={13} />
        <input placeholder="Buscar responsable…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div class="owner-list-scroll">
        {teams.length > 0 && <div class="opt-group">Equipos</div>}
        {teams.map(row)}
        {people.length > 0 && <div class="opt-group">Personas</div>}
        {people.map(row)}
        {!list.length && <div class="opt-empty">Sin resultados</div>}
      </div>
    </div>
  );
}

/** Evento para enfocar la búsqueda desde un atajo de teclado ("/"). */
export const FOCUS_SEARCH_EVENT = 'gm:focus-search';

/**
 * Dock flotante de filtros rápidos: se aplican al instante y no tocan el código.
 * "Guardar en vista" los pasa al bloque de la vista activa.
 */
export function FilterDock({ matchCount, totalCount }: { matchCount: number; totalCount: number }) {
  const q = quickFilter.value;
  const s = settings.value;
  const d = doc.value;
  const open = dockOpen.value;
  const active = quickActive(q);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeCount = q.owners.length + q.tags.length + (q.text.trim() ? 1 : 0);

  useEffect(() => {
    const onFocus = () => {
      dockOpen.value = true;
      setTimeout(() => searchRef.current?.focus(), 30);
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocus);
  }, []);

  const customTags = [...new Set(d.tasks.flatMap((t) => t.spec.tags))].filter((t) => !RESERVED.has(t)).slice(0, 8);
  const viewFilter = [
    ...s.filterOwners.map((o) => `@${o}`),
    ...s.filterTags.map((t) => `#${t}`),
    ...(s.filterText ? [`"${s.filterText}"`] : []),
  ];
  const cls = ['filter-dock', open ? 'open' : 'closed', inspectorOpen.value ? 'with-inspector' : ''].join(' ');

  if (!open) {
    return (
      <div class={cls}>
        <button class="dock-pill" onClick={() => (dockOpen.value = true)} title="Mostrar filtros (F)">
          <Icon name="filter" size={14} />
          Filtros
          {activeCount > 0 && <span class="dock-badge">{activeCount}</span>}
          {active && <span class="dock-count">{matchCount}/{totalCount}</span>}
        </button>
      </div>
    );
  }

  return (
    <div class={cls} role="toolbar" aria-label="Filtros rápidos">
      <div class="dock-inner">
        {viewFilter.length > 0 && (
          <>
            <span class="dock-view-chip" title={`Filtro guardado en la vista ${currentView.value ?? 'Principal'}`}>
              <Icon name="eye" size={12} /> {viewFilter.join(' ')}
              <button onClick={() => setViewFilter([], [], '')} title="Quitar el filtro de la vista (edita el código)">
                <Icon name="x" size={11} />
              </button>
            </span>
            <span class="dock-sep" />
          </>
        )}
        <label class="dock-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            placeholder="Buscar…"
            value={q.text}
            onInput={(e) => (quickFilter.value = { ...q, text: (e.target as HTMLInputElement).value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                if (q.text) quickFilter.value = { ...q, text: '' };
                else (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <span class="kbd">/</span>
        </label>
        <span class="dock-sep" />
        <OwnerStack selected={q.owners} />

        <span class="dock-sep" />
        <div class="dock-group">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.tag}
              class={`dock-chip ${q.tags.includes(c.tag) ? 'on' : ''}`}
              style={{ '--c': c.color } as Record<string, string>}
              onClick={() => toggleQuickTag(c.tag)}
            >
              <span class="dot" />
              {c.label}
            </button>
          ))}
          {customTags.map((t) => (
            <button key={t} class={`dock-chip ${q.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleQuickTag(t)}>
              #{t}
            </button>
          ))}
        </div>
        <span class="dock-sep" />
        <button
          class={`icon-btn sm dock-mode ${q.mode === 'dim' ? 'active' : ''}`}
          title={q.mode === 'dim' ? 'Atenuando lo que no coincide (clic para ocultarlo)' : 'Ocultando lo que no coincide (clic para atenuarlo y verlo en contexto)'}
          aria-pressed={q.mode === 'dim'}
          onClick={() => (quickFilter.value = { ...q, mode: q.mode === 'dim' ? 'hide' : 'dim' })}
        >
          <Icon name="eye" size={15} />
        </button>
        <span class={`dock-count ${active ? 'on' : ''}`} title="Tareas que coinciden">
          {matchCount}/{totalCount}
        </span>
        {active && (
          <>
            <button class="icon-btn sm" title="Limpiar filtros" onClick={clearQuickFilter}>
              <Icon name="x" size={14} />
            </button>
            <button class="icon-btn sm dock-save" title="Guardar en vista: escribe este filtro en el código de la vista activa" onClick={saveQuickFilterToView}>
              <Icon name="save" size={14} />
            </button>
          </>
        )}
        <button class="icon-btn sm" title="Ocultar filtros (F)" onClick={() => (dockOpen.value = false)}>
          <Icon name="chevronDown" size={15} />
        </button>
      </div>
    </div>
  );
}
