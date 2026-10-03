import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { countWorkdays, formatShort, parseIso, toIso } from '../core/dates';
import type { Column, GanttDoc, TaskNode } from '../core/types';
import { moveTask, moveTaskToSection, renameSection, retimeTask, type MovePosition } from '../core/writer';
import type { Layout, Row } from '../render/layout';
import { addSection, addTaskToSection, patchTask, renaming, selectTask, startRename, toggleCollapse, toggleQuickOwner } from '../state/actions';
import { doc as docSignal, edit, presenting, selectedKey } from '../state/store';
import { initials } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Autocomplete, DateInput } from '../ui/inputs';
import { ownerSuggestions } from './Inspector';
import { openSectionMenu, openTaskMenu } from './menus';
import { panJustEnded } from './pan';

interface Props {
  L: Layout;
  d: GanttDoc;
  minHeight: number;
  renamingSection: string | null;
  setRenamingSection: (k: string | null) => void;
}

interface Reorder {
  key: string;
  target: { key: string; pos: MovePosition; kind: Row['kind'] } | null;
}

/** Avance ponderado por duración de las hojas de una tarea o sección. */
function rollupProgress(tasks: TaskNode[], d: GanttDoc): number | undefined {
  let total = 0, done = 0, any = false;
  const walk = (t: TaskNode) => {
    if (t.children.length) return t.children.forEach(walk);
    if (t.spec.milestone) return;
    const w = Math.max(1, countWorkdays(d.calendar, t.start, t.end));
    const p = t.spec.progress ?? (t.status === 'done' ? 100 : 0);
    if (t.spec.progress !== undefined || t.status === 'done') any = true;
    total += w;
    done += (w * p) / 100;
  };
  tasks.forEach(walk);
  return any && total ? Math.round((done / total) * 100) : undefined;
}

/** Edición en línea de una celda (doble clic). */
type CellEdit = { key: string; col: Column };

export function Grid({ L, d, minHeight, renamingSection, setRenamingSection }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [reorder, setReorderState] = useState<Reorder | null>(null);
  const [cell, setCell] = useState<CellEdit | null>(null);
  const reorderRef = useRef<Reorder | null>(null);
  const setReorder = (r: Reorder | null) => {
    reorderRef.current = r;
    setReorderState(r);
  };
  const LRef = useRef(L);
  LRef.current = L;
  const selected = selectedKey.value;
  const renamingKey = renaming.value?.where === 'grid' ? renaming.value.key : null;

  // --- Reordenar arrastrando el asa (listeners registrados en el mismo pointerdown) ---
  const startReorder = (key: string) => {
    setReorder({ key, target: null });
    const dragged = d.tasks.find((t) => t.key === key);
    const isInside = (t: TaskNode | undefined) => {
      for (let p: TaskNode | null | undefined = t; p; p = p.parent) if (p === dragged) return true;
      return false;
    };
    const onMove = (e: PointerEvent) => {
      const L = LRef.current;
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      const y = e.clientY - top;
      const idx = Math.max(0, Math.min(L.rows.length - 1, Math.floor(y / L.rowH)));
      const row = L.rows[idx];
      const frac = (y - row.y) / L.rowH;
      let target: Reorder['target'] = null;
      if (row.kind === 'section') {
        target = { key: row.key, pos: 'inside', kind: 'section' };
      } else if (row.task && !isInside(row.task)) {
        const pos: MovePosition = frac < 0.3 ? 'before' : frac > 0.7 || row.task.spec.milestone ? 'after' : 'inside';
        target = { key: row.key, pos, kind: 'task' };
      }
      setReorder({ key, target });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const cur = reorderRef.current;
      setReorder(null);
      if (!cur?.target) return;
      const { key: targetKey, pos, kind } = cur.target;
      if (kind === 'section') edit((text, doc) => moveTaskToSection(text, doc, cur.key, targetKey));
      else edit((text, doc) => moveTask(text, doc, cur.key, targetKey, pos));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Doble clic en una celda: acción rápida según la columna. */
  const onCellDblClick = (r: Row, col: 'name' | Column, e: MouseEvent) => {
    e.stopPropagation();
    if (presenting.value) return;
    if (r.kind === 'section') {
      setRenamingSection(r.key);
      return;
    }
    const t = r.task!;
    if (col === 'name') {
      startRename(r.key, 'grid');
      return;
    }
    if (t.children.length && col !== 'owner') {
      // Las fechas de un padre se calculan: abrir el panel
      selectTask(r.key, { open: true });
      return;
    }
    if (t.spec.milestone && (col === 'duration' || col === 'progress')) return;
    setCell({ key: r.key, col });
  };

  const commitCell = (r: Row, col: Column, raw: string | null) => {
    setCell(null);
    if (raw === null || !r.task) return;
    const t = r.task;
    const v = raw.trim();
    switch (col) {
      case 'owner': {
        const owners = v.split(',').map((o) => o.trim().replace(/^@/, '')).filter(Boolean)
          .map((o) => docSignal.value.owners.get(o.toLowerCase())?.name ?? o);
        patchTask(r.key, { owners });
        break;
      }
      case 'start': {
        const day = parseIso(v);
        if (day !== null && day !== t.start) edit((text, doc) => retimeTask(text, doc, r.key, day, day + (t.end - t.start), 'move'));
        break;
      }
      case 'end': {
        const day = parseIso(v);
        if (day !== null && day + 1 !== t.end) edit((text, doc) => retimeTask(text, doc, r.key, t.start, Math.max(t.start + 1, day + 1), 'resize-end'));
        break;
      }
      case 'duration': {
        const n = Math.round(+v);
        if (n >= 1) patchTask(r.key, { duration: { n, unit: 'd' }, end: undefined });
        break;
      }
      case 'progress': {
        const p = Math.round(+v.replace('%', ''));
        if (!Number.isNaN(p)) patchTask(r.key, { progress: Math.max(0, Math.min(100, p)) });
        break;
      }
    }
  };

  const H = Math.max(L.height, minHeight);

  // Presentando con una tarea destacada: atenuar lo que no está conectado con ella
  const focus = presenting.value && selected ? new Set([selected]) : null;
  if (focus) {
    for (const dep of L.deps) {
      if (dep.from.key === selected) focus.add(dep.to.key);
      if (dep.to.key === selected) focus.add(dep.from.key);
    }
  }

  return (
    <div
      class="grid"
      ref={ref}
      style={{ width: L.gridW, height: H }}
      onDblClick={(e) => {
        // Doble clic debajo de las filas → nueva tarea en la última sección
        if (e.target !== ref.current || panJustEnded()) return;
        const last = d.sections[d.sections.length - 1];
        if (last) addTaskToSection(last.key);
        else addSection();
      }}
    >
      {L.rows.map((r) => {
        const t = r.task;
        const isSection = r.kind === 'section';
        const isSummary = isSection || (t?.children.length ?? 0) > 0;
        const drop = reorder?.target?.key === r.key ? reorder.target.pos : null;
        const cls = [
          'grid-row',
          isSection ? 'section' : '',
          isSummary ? 'summary' : '',
          t?.status === 'done' ? 'done' : '',
          selected === r.key ? 'selected' : '',
          drop ? `drop-${drop}` : '',
          reorder?.key === r.key ? 'dragging' : '',
          r.dimmed || (focus && !focus.has(r.key)) ? 'dimmed' : '',
        ].join(' ');
        const indent = isSection ? 0 : (r.depth + (r.section.line >= 0 ? 1 : 0)) * 16;
        const progress = isSection
          ? rollupProgress(r.section.tasks, d)
          : t && t.children.length
            ? rollupProgress([t], d)
            : t?.spec.progress ?? (t?.status === 'done' ? 100 : undefined);
        const editing = cell?.key === r.key ? cell.col : null;

        return (
          <div
            key={r.key}
            class={cls}
            style={{ transform: `translateY(${r.y}px)`, height: L.rowH }}
            onClick={() => {
              if (!t) return;
              if (presenting.value) selectedKey.value = selectedKey.value === r.key ? null : r.key;
              else selectTask(r.key);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (presenting.value) return;
              if (t) openTaskMenu(e, r);
              else openSectionMenu(e, r, () => setRenamingSection(r.key));
            }}
          >
            {L.columns.map((c) => {
              if (c.key === 'name') {
                return (
                  <div class="cell name" key="name" style={{ width: c.width, paddingLeft: 12 + indent }} onDblClick={(e) => onCellDblClick(r, 'name', e)}>
                    {t && (
                      <span
                        class="grip"
                        title="Arrastrar para reordenar o anidar"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          startReorder(r.key);
                        }}
                      >
                        <Icon name="grip" size={12} />
                      </span>
                    )}
                    {r.hasChildren ? (
                      <button
                        class={`chev ${r.folded ? 'folded' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(r.key);
                        }}
                        onDblClick={(e) => e.stopPropagation()}
                        aria-label={r.folded ? 'Expandir' : 'Colapsar'}
                      >
                        <Icon name="chevron" size={14} />
                      </button>
                    ) : (
                      <span class="chev-space" />
                    )}
                    {!isSection && <span class={`dot ${t?.spec.milestone ? 'ms' : ''}`} style={{ background: t?.spec.milestone ? 'var(--text)' : r.color }} />}
                    {isSection && <span class="dot" style={{ background: r.color, borderRadius: 2 }} />}
                    {(isSection ? renamingSection === r.key : renamingKey === r.key) ? (
                      <InlineInput
                        value={r.label}
                        onDone={(v) => {
                          if (isSection) {
                            setRenamingSection(null);
                            if (v && v !== r.label) edit((text, doc) => renameSection(text, doc, r.key, v));
                          } else {
                            renaming.value = null;
                            if (v && v !== r.label) patchTask(r.key, { name: v });
                          }
                        }}
                      />
                    ) : (
                      <span class="name-text" title={`${r.label} · doble clic para renombrar`}>{r.label}</span>
                    )}
                    {isSection && <span class="count">{r.section.tasks.length}</span>}
                    {isSection && (
                      <span class="row-actions">
                        <button class="icon-btn sm" title="Agregar tarea" onClick={(e) => { e.stopPropagation(); addTaskToSection(r.key); }} onDblClick={(e) => e.stopPropagation()}>
                          <Icon name="plus" size={14} />
                        </button>
                      </span>
                    )}
                    {t && (
                      <span class="row-actions" onDblClick={(e) => e.stopPropagation()}>
                        <button class="icon-btn sm" title="Editar" onClick={(e) => { e.stopPropagation(); selectTask(r.key, { open: true }); }}>
                          <Icon name="sliders" size={13} />
                        </button>
                        <button class="icon-btn sm" title="Más acciones" onClick={(e) => { e.stopPropagation(); openTaskMenu(e, r); }}>
                          <Icon name="more" size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              }

              const dbl = (e: MouseEvent) => onCellDblClick(r, c.key as Column, e);
              if (editing === c.key && t) {
                return (
                  <div class={`cell ${c.key === 'owner' ? '' : 'num'}`} key={c.key} style={{ width: c.width }}>
                    <CellEditor col={c.key as Column} t={t} d={d} onDone={(v) => commitCell(r, c.key as Column, v)} />
                  </div>
                );
              }
              if (c.key === 'owner') {
                const owners = t?.spec.owners ?? [];
                const o = owners[0] ? d.owners.get(owners[0].toLowerCase()) : undefined;
                return (
                  <div class="cell editable" key="owner" style={{ width: c.width }} onDblClick={dbl} title={t ? 'Doble clic para editar' : undefined}>
                    {o && (
                      <>
                        <span
                          class={`avatar ${o.kind === 'team' ? 'team' : ''}`}
                          style={{ background: o.color }}
                          title={`${o.name} · Alt+clic para filtrar`}
                          onClick={(e) => {
                            if (!e.altKey) return;
                            e.stopPropagation();
                            toggleQuickOwner(o.name);
                          }}
                        >
                          {initials(o.name)}
                        </span>
                        <span class="owner-name">{o.name}</span>
                        {owners.length > 1 && <span class="count">+{owners.length - 1}</span>}
                      </>
                    )}
                  </div>
                );
              }
              if (c.key === 'start') return <div class="cell num editable" key="start" style={{ width: c.width }} onDblClick={dbl}>{formatShort(r.start)}</div>;
              if (c.key === 'end') {
                const ms = t?.spec.milestone;
                return <div class="cell num editable" key="end" style={{ width: c.width }} onDblClick={dbl}>{formatShort(ms ? r.start : r.end - 1)}</div>;
              }
              if (c.key === 'duration') {
                const label = t?.spec.milestone ? '◆' : `${countWorkdays(d.calendar, r.start, r.end)}d`;
                return <div class="cell num editable" key="duration" style={{ width: c.width }} onDblClick={dbl}>{label}</div>;
              }
              if (c.key === 'progress') {
                return (
                  <div class="cell num editable" key="progress" style={{ width: c.width }} onDblClick={dbl}>
                    {progress !== undefined && (
                      <>
                        <span class="mini-progress"><span style={{ width: `${progress}%` }} /></span>
                        {progress}%
                      </>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        );
      })}
    </div>
  );
}

function useAutoFocus<T extends HTMLInputElement>() {
  const ref = useRef<T>(null);
  // useLayoutEffect: el foco tiene que estar antes de que el usuario empiece a tipear
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select?.();
  }, []);
  return ref;
}

function InlineInput({ value, onDone, type = 'text', list, className = 'name-input' }: {
  value: string;
  onDone: (v: string | null) => void;
  type?: string;
  list?: string;
  className?: string;
}) {
  const ref = useAutoFocus<HTMLInputElement>();
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      class={className}
      type={type}
      list={list}
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value.trim());
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish((e.target as HTMLInputElement).value.trim())}
    />
  );
}

/** Fecha en la grilla: abre el calendario directamente; cerrar sin elegir cancela. */
function CellDate({ value, calendar, onDone }: { value: string; calendar: GanttDoc['calendar']; onDone: (v: string | null) => void }) {
  const picked = useRef<string | null>(null);
  return (
    <DateInput
      className="cell-date"
      value={value}
      calendar={calendar}
      autoOpen
      onChange={(iso) => (picked.current = iso)}
      onDone={() => onDone(picked.current)}
    />
  );
}

function CellEditor({ col, t, d, onDone }: { col: Column; t: TaskNode; d: GanttDoc; onDone: (v: string | null) => void }) {
  switch (col) {
    case 'owner':
      return (
        <Autocomplete
          className="name-input cell-input"
          value={t.spec.owners.join(', ')}
          multiple
          autoFocus
          suggestions={ownerSuggestions([...d.owners.values()])}
          onSubmit={(v) => onDone(v)}
          onBlurValue={(v) => onDone(v)}
          onCancel={() => onDone(null)}
        />
      );
    case 'start':
    case 'end':
      return <CellDate value={col === 'start' ? toIso(t.start) : toIso(Math.max(t.start, t.end - 1))} calendar={d.calendar} onDone={onDone} />;
    case 'duration':
      return <InlineInput className="name-input cell-input" type="number" value={String(countWorkdays(d.calendar, t.start, t.end))} onDone={onDone} />;
    case 'progress':
      return <InlineInput className="name-input cell-input" type="number" value={String(t.spec.progress ?? 0)} onDone={onDone} />;
  }
}
