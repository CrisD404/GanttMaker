import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { SVGAttributes } from 'preact';
import { countWorkdays, formatShort, type Day } from '../core/dates';
import { wouldCreateCycle } from '../core/schedule';
import type { GanttDoc, ViewSettings } from '../core/types';
import { addDependency, removeDependency, retimeTask } from '../core/writer';
import type { DepLink, Layout, Row } from '../render/layout';
import { depRoute } from '../render/paths';
import { textWidth } from '../render/text';
import { createTaskAt, patchTask, renaming, selectTask, startRename, toggleCollapse, toggleQuickOwner } from '../state/actions';
import { edit, inspectorOpen, presenting, selectedKey, toast, toastUndo } from '../state/store';
import { initials } from '../ui/controls';
import { openChartMenu, openDepMenu, openOwnerMenu, openSectionMenu, openTaskMenu } from './menus';
import { panJustEnded } from './pan';

type DragMode = 'move' | 'resize-start' | 'resize-end';
type Drag =
  | { mode: DragMode; key: string; originX: number; origStart: Day; origEnd: Day; start: Day; end: Day; moved: boolean; milestone: boolean }
  | { mode: 'link'; key: string; x1: number; y1: number; x2: number; y2: number; target: string | null };

export interface HoverInfo {
  row: Row;
  clientX: number;
  clientY: number;
}

interface Props {
  L: Layout;
  s: ViewSettings;
  d: GanttDoc;
  onHover: (h: HoverInfo | null) => void;
  /** Alto mínimo (para que el área vacía bajo las filas también sea interactiva). */
  minHeight: number;
  onRenameSection: (key: string) => void;
}

const LABEL_FONT = '500 11.5px Inter, system-ui, sans-serif';
const DBL_MS = 380;

export function Chart({ L, s, d, onHover, minHeight, onRenameSection }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [selectedDep, setSelectedDep] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // La ref se actualiza en el acto: pointerup puede llegar antes del siguiente render
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const LRef = useRef(L);
  LRef.current = L;
  const dRef = useRef(d);
  dRef.current = d;
  const lastClick = useRef<{ key: string; t: number } | null>(null);

  const px = L.pxPerDay;
  const x = (day: Day) => (day - L.rangeStart) * px;
  const rowH = L.rowH;
  const barH = Math.round(rowH * 0.6);
  const barTop = (rowH - barH) / 2;
  const selected = selectedKey.value;
  const H = Math.max(L.height, minHeight);

  // --- Coordenadas ---------------------------------------------------------
  const svgPoint = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };
  const dayAt = (sx: number) => L.rangeStart + Math.floor(sx / px);
  const rowAt = (sy: number): Row | null => L.rows[Math.floor(sy / rowH)] ?? null;

  // --- Arrastre (listeners registrados en el mismo pointerdown) -------------
  const beginDrag = (row: Row, mode: DragMode) => (e: PointerEvent) => {
    if (e.button !== 0 || !row.task) return;
    e.stopPropagation();
    e.preventDefault();
    if (presenting.value) {
      // Presentando: no se edita; un clic destaca la tarea (y sus dependencias)
      selectedKey.value = selectedKey.value === row.key ? null : row.key;
      return;
    }
    onHover(null);
    const canTime = !row.task.children.length;
    setDrag({
      mode: canTime ? mode : 'move',
      key: row.key,
      originX: e.clientX,
      origStart: row.start,
      origEnd: row.end,
      start: row.start,
      end: row.end,
      moved: false,
      milestone: row.task.spec.milestone,
    });
    listen();
  };

  const beginLink = (row: Row) => (e: PointerEvent) => {
    if (e.button !== 0 || presenting.value) return;
    e.stopPropagation();
    e.preventDefault();
    onHover(null);
    const x1 = row.task?.spec.milestone ? x(row.start) + barH / 2 : x(row.end);
    const p = svgPoint(e.clientX, e.clientY);
    setDrag({ mode: 'link', key: row.key, x1, y1: row.y + rowH / 2, x2: p.x, y2: p.y, target: null });
    listen();
  };

  /** Clic simple → seleccionar y abrir el panel; doble clic → acción rápida sobre la barra. */
  const onBarClick = (key: string) => {
    const now = performance.now();
    const prev = lastClick.current;
    if (prev && prev.key === key && now - prev.t < DBL_MS) {
      lastClick.current = null;
      const t = dRef.current.tasks.find((x) => x.key === key);
      if (t?.children.length) toggleCollapse(key);
      else startRename(key, 'chart');
      return;
    }
    lastClick.current = { key, t: now };
    selectTask(key, { open: true });
  };

  const listen = () => {
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.mode === 'link') {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-key]') as HTMLElement | null;
        const target = el?.dataset.key && el.dataset.key !== cur.key && el.dataset.kind === 'task' ? el.dataset.key : null;
        const p = svgPoint(e.clientX, e.clientY);
        setDrag({ ...cur, x2: p.x, y2: p.y, target });
        return;
      }
      const dx = e.clientX - cur.originX;
      const days = Math.round(dx / LRef.current.pxPerDay);
      const moved = cur.moved || Math.abs(dx) > 3;
      let start = cur.origStart, end = cur.origEnd;
      if (cur.mode === 'move' || cur.milestone) {
        start += days;
        end += days;
      } else if (cur.mode === 'resize-end') {
        end = Math.max(cur.origStart + 1, cur.origEnd + days);
      } else {
        start = Math.min(cur.origEnd - 1, cur.origStart + days);
      }
      if (start !== cur.start || end !== cur.end || moved !== cur.moved) setDrag({ ...cur, start, end, moved });
    };
    const onUp = () => {
      cleanup();
      const cur = dragRef.current;
      const d = dRef.current;
      setDrag(null);
      if (!cur) return;
      if (cur.mode === 'link') {
        if (!cur.target) return;
        const from = d.tasks.find((t) => t.key === cur.key);
        const to = d.tasks.find((t) => t.key === cur.target);
        if (!from || !to) return;
        if (wouldCreateCycle(from, to)) {
          toast('Esa dependencia generaría un ciclo', 'error');
          return;
        }
        edit((text, doc) => addDependency(text, doc, cur.key, cur.target!));
        toast(`"${to.spec.name}" ahora empieza después de "${from.spec.name}"`, 'success');
        return;
      }
      if (!cur.moved) {
        onBarClick(cur.key);
        return;
      }
      lastClick.current = null;
      const t = d.tasks.find((x) => x.key === cur.key);
      if (!t || t.children.length) {
        if (t?.children.length) toast('Las tareas con subtareas se ajustan solas: mové sus subtareas', 'info');
        return;
      }
      if (cur.start === cur.origStart && cur.end === cur.origEnd) return;
      edit((text, doc) => retimeTask(text, doc, cur.key, cur.start, cur.end, cur.mode));
      if (cur.mode !== 'resize-end' && t.deps.length && cur.start < Math.max(...t.deps.map((x) => x.end))) {
        toast('No puede empezar antes de que terminen sus dependencias', 'info');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        setDrag(null);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
  };

  // --- Dependencias ---------------------------------------------------------
  const removeDep = (depKey: string) => {
    const [fromKey, toKey] = depKey.split('->');
    edit((text, doc) => removeDependency(text, doc, fromKey, toKey));
    setSelectedDep(null);
    toastUndo('Dependencia eliminada');
  };

  // Supr sobre una dependencia seleccionada
  useLayoutEffect(() => {
    if (!selectedDep) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('input, textarea, .cm-editor')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        removeDep(selectedDep);
      } else if (e.key === 'Escape') setSelectedDep(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedDep]);

  // Fechas efectivas (con la vista previa del arrastre)
  const span = (r: Row) => (drag && drag.mode !== 'link' && drag.key === r.key ? { start: drag.start, end: drag.end } : { start: r.start, end: r.end });

  // Resaltado de dependencias de la tarea apuntada o seleccionada
  const focusKeys = new Set([hoverKey, selected].filter(Boolean) as string[]);
  const related = new Set<string>();
  for (const dep of L.deps) {
    if (focusKeys.has(dep.from.key)) related.add(dep.to.key);
    if (focusKeys.has(dep.to.key)) related.add(dep.from.key);
  }
  const hoverHasDeps = !!hoverKey && L.deps.some((x) => x.from.key === hoverKey || x.to.key === hoverKey);

  // --- Fondo: clic, doble clic y menú ----------------------------------------
  const isBackground = (target: EventTarget | null) => !(target as Element | null)?.closest('.bar-row, .dep-group, .avatar-hit');

  const onBgPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !isBackground(e.target)) return;
    setSelectedDep(null);
    if (selectedKey.value) selectTask(null);
    inspectorOpen.value = false;
  };
  const nearOf = (row: Row | null) => (row ? { kind: row.kind, key: row.key } as const : null);
  const onBgDblClick = (e: MouseEvent) => {
    if (!isBackground(e.target) || panJustEnded() || presenting.value) return;
    const p = svgPoint(e.clientX, e.clientY);
    createTaskAt(dayAt(p.x), nearOf(rowAt(p.y)));
  };
  const onBgContextMenu = (e: MouseEvent) => {
    if (!isBackground(e.target)) return;
    e.preventDefault();
    if (presenting.value) return;
    const p = svgPoint(e.clientX, e.clientY);
    openChartMenu(e, dayAt(p.x), nearOf(rowAt(p.y)));
  };

  const draggingKey = drag?.key;
  const dragBadge = drag && drag.mode !== 'link' && drag.moved ? drag : null;
  const rename = renaming.value?.where === 'chart' ? L.rowByKey.get(renaming.value.key) : undefined;

  // Bandas de sprint alternadas
  const sprintBands = L.sprints.map((sp, i) => ({ key: sp.start, x: x(sp.start), w: (sp.end - sp.start) * px, odd: i % 2 === 1 }));

  return (
    <div class="chart-wrap" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        class={`chart ${hoverHasDeps ? 'deps-dim' : ''} ${presenting.value && selected ? 'focus-mode' : ''}`}
        width={L.width}
        height={H}
        onPointerDown={onBgPointerDown}
        onDblClick={onBgDblClick}
        onContextMenu={onBgContextMenu}
      >
        <defs>
          {[['arrow', 'var(--dep-color)'], ['arrow-hl', 'var(--accent)'], ['arrow-crit', 'var(--danger)']].map(([id, fill]) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M 1 1.2 L 9 5 L 1 8.8 L 2.6 5 z" fill={fill} />
            </marker>
          ))}
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.45)" stroke-width="3" />
          </pattern>
        </defs>

        {/* Fondo */}
        <rect class="bg-hit" x={0} y={0} width={L.width} height={H} fill="transparent" />
        {s.features.sprints && sprintBands.map((b) => b.odd && <rect key={`sp${b.key}`} class="sprint-band" x={b.x} y={0} width={b.w} height={H} />)}
        {L.rows.map((r) => r.kind === 'section' && <rect key={`band-${r.key}`} class="section-band" x={0} y={r.y} width={L.width} height={rowH} />)}
        {L.nonWorking.map((n, i) => <rect key={`nw${i}`} class="weekend" x={n.x} y={0} width={n.w} height={H} />)}
        {s.features.grid && L.bottom.map((t) => <line key={t.key} class={`grid-v ${t.strong ? 'strong' : ''}`} x1={t.x} x2={t.x} y1={0} y2={H} />)}
        {s.features.grid && L.top.map((t) => <line key={`top-${t.key}`} class="grid-v strong" x1={t.x} x2={t.x} y1={0} y2={H} />)}
        {L.sprintTier.map((t) => <line key={`spl-${t.key}`} class="sprint-line" x1={t.x} x2={t.x} y1={0} y2={H} />)}
        {s.features.grid && L.rows.map((r) => <line key={`h-${r.key}`} class="grid-h" x1={0} x2={L.width} y1={r.y + rowH - 0.5} y2={r.y + rowH - 0.5} />)}
        {selected && L.rowByKey.get(selected) && (
          <rect class="selected-band" x={0} y={L.rowByKey.get(selected)!.y} width={L.width} height={rowH} />
        )}

        {/* Dependencias (las resaltadas se dibujan al final, encima) */}
        <g class="deps">
          {[...L.deps]
            .sort((a, b) => Number(isHl(a, focusKeys)) - Number(isHl(b, focusKeys)))
            .map((dep) => (
              <DepPath
                key={dep.key}
                dep={dep}
                span={span}
                x={x}
                rowH={rowH}
                barH={barH}
                highlighted={isHl(dep, focusKeys)}
                selected={selectedDep === dep.key}
                onSelect={() => setSelectedDep(dep.key)}
                onDelete={() => removeDep(dep.key)}
              />
            ))}
        </g>

        {/* Barras */}
        <g>
          {L.rows.map((r) => {
            const { start, end } = span(r);
            const bx = x(start);
            const bw = Math.max(r.task?.spec.milestone ? 0 : 3, (end - start) * px);
            const isMs = !!r.task?.spec.milestone;
            const isSummary = r.kind === 'section' || (r.task?.children.length ?? 0) > 0;
            const t = r.task;
            const cls = [
              'bar-row',
              t?.status ?? '',
              t?.critical ? 'crit' : '',
              selected === r.key ? 'selected' : '',
              draggingKey === r.key ? 'dragging' : '',
              drag?.mode === 'link' && drag.target === r.key ? 'link-target' : '',
              related.has(r.key) ? 'related' : '',
              r.dimmed ? 'dimmed' : '',
            ].join(' ');
            const common = {
              'data-key': r.key,
              'data-kind': r.kind,
              class: cls,
              style: { transform: `translate(${bx}px, ${r.y}px)` },
              onPointerEnter: (e: PointerEvent) => {
                if (dragRef.current) return;
                setHoverKey(r.key);
                onHover({ row: r, clientX: e.clientX, clientY: e.clientY });
              },
              onPointerMove: (e: PointerEvent) => !dragRef.current && onHover({ row: r, clientX: e.clientX, clientY: e.clientY }),
              onPointerLeave: () => {
                setHoverKey(null);
                onHover(null);
              },
              onContextMenu: (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                onHover(null);
                if (presenting.value) return;
                if (r.task) openTaskMenu(e, r);
                else openSectionMenu(e, r, () => onRenameSection(r.key));
              },
              onDblClick: (e: MouseEvent) => {
                // Las barras de tarea detectan su doble clic en pointerup; aquí solo las secciones
                if (r.kind === 'section') {
                  e.stopPropagation();
                  toggleCollapse(r.key);
                }
              },
            };
            if (isMs) return <Milestone key={r.key} r={r} common={common} size={barH} rowH={rowH} s={s} beginDrag={beginDrag} beginLink={beginLink} />;
            if (isSummary) return <Summary key={r.key} r={r} common={common} w={bw} rowH={rowH} s={s} px={px} rangeStart={L.rangeStart} bx={bx} beginDrag={beginDrag} />;
            return (
              <TaskBar key={r.key} r={r} d={d} common={common} w={bw} barH={barH} barTop={barTop} rowH={rowH} s={s} beginDrag={beginDrag} beginLink={beginLink} />
            );
          })}
        </g>

        {/* Hoy */}
        {s.features.today && L.today >= L.rangeStart && L.today <= L.rangeEnd && (
          <line class="today-line" x1={x(L.today)} x2={x(L.today)} y1={0} y2={H} />
        )}

        {/* Línea de vínculo en curso */}
        {drag?.mode === 'link' && (
          <path class="link-line" d={`M ${drag.x1} ${drag.y1} C ${drag.x1 + 40} ${drag.y1}, ${drag.x2 - 40} ${drag.y2}, ${drag.x2} ${drag.y2}`} marker-end="url(#arrow-hl)" />
        )}
      </svg>

      {dragBadge && (() => {
        const r = L.rowByKey.get(dragBadge.key);
        if (!r) return null;
        const n = countWorkdays(d.calendar, dragBadge.start, dragBadge.end);
        const label = dragBadge.milestone
          ? formatShort(dragBadge.start)
          : `${formatShort(dragBadge.start)} → ${formatShort(dragBadge.end - 1)} · ${n}d`;
        return (
          <div class="drag-badge" style={{ left: x(dragBadge.start) + ((dragBadge.end - dragBadge.start) * px) / 2, top: r.y + barTop - 6 }}>
            {label}
          </div>
        );
      })()}

      {rename && rename.task && (
        <ChartRename
          key={rename.key}
          value={rename.label}
          left={rename.task.spec.milestone ? x(rename.start) + barH / 2 + 16 : x(rename.start)}
          top={rename.y + (rowH - 28) / 2}
          width={Math.max(190, rename.task.spec.milestone ? 0 : (rename.end - rename.start) * px)}
          onDone={(v) => {
            renaming.value = null;
            if (v && v !== rename.label) patchTask(rename.key, { name: v });
          }}
        />
      )}
    </div>
  );
}

function isHl(dep: DepLink, keys: Set<string>) {
  return keys.has(dep.from.key) || keys.has(dep.to.key);
}

function ChartRename({ value, left, top, width, onDone }: { value: string; left: number; top: number; width: number; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      class="chart-rename"
      style={{ left, top, width }}
      defaultValue={value}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value.trim());
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish((e.target as HTMLInputElement).value.trim())}
    />
  );
}

// ---------------------------------------------------------------------------

type Common = SVGAttributes<SVGGElement> & Record<string, unknown>;

function Avatars({ owners, x0, cy }: { owners: { name: string; color: string; kind: string }[]; x0: number; cy: number }) {
  return (
    <>
      {owners.map((o, i) => {
        const cx = x0 + 9 + i * 14;
        return (
          <g
            key={o.name}
            class="avatar-hit"
            onPointerDown={(e) => e.stopPropagation()}
            onDblClick={(e) => {
              e.stopPropagation();
              if (!presenting.value) toggleQuickOwner(o.name);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!presenting.value) openOwnerMenu(e, o.name);
            }}
          >
            <title>{`${o.name} · doble clic para filtrar`}</title>
            <rect x={cx - 9} y={cy - 9} width={18} height={18} rx={o.kind === 'team' ? 5 : 9} fill={o.color} stroke="var(--surface)" stroke-width={2} />
            <text x={cx} y={cy + 3.5} text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff">{initials(o.name)}</text>
          </g>
        );
      })}
    </>
  );
}

function TaskBar({ r, d, common, w, barH, barTop, rowH, s, beginDrag, beginLink }: {
  r: Row; d: GanttDoc; common: Common; w: number; barH: number; barTop: number; rowH: number; s: ViewSettings;
  beginDrag: (r: Row, m: DragMode) => (e: PointerEvent) => void;
  beginLink: (r: Row) => (e: PointerEvent) => void;
}) {
  const t = r.task!;
  const color = r.color;
  const progress = t.spec.progress;
  const hasProgress = s.features.progress && progress !== undefined;
  const label = t.status === 'done' ? `✓ ${t.spec.name}` : t.spec.name;
  const labelW = textWidth(label, LABEL_FONT);
  const inside = labelW + 18 <= w;
  const owners = s.features.avatars
    ? (t.spec.owners.slice(0, 3).map((o) => d.owners.get(o.toLowerCase())).filter(Boolean) as { name: string; color: string; kind: string }[])
    : [];
  const rx = Math.min(6, barH / 2.5);
  const cy = rowH / 2;
  const ox = w + 22;
  const labelX = owners.length ? ox + 9 + owners.length * 14 + 6 : ox;

  return (
    <g {...common}>
      {hasProgress ? (
        <>
          <rect class="bar-bg" x={0} y={barTop} width={w} height={barH} rx={rx} fill={color} opacity={0.28} style={{ width: `${w}px` }} />
          <rect class="bar-progress" x={0} y={barTop} width={(w * progress!) / 100} height={barH} rx={rx} fill={color} style={{ width: `${(w * progress!) / 100}px` }} />
        </>
      ) : (
        <rect class="bar" x={0} y={barTop} width={w} height={barH} rx={rx} fill={color} style={{ width: `${w}px` }} />
      )}
      {t.status === 'blocked' && <rect x={0} y={barTop} width={w} height={barH} rx={rx} fill="url(#hatch)" style={{ width: `${w}px`, pointerEvents: 'none' }} />}
      <rect class="bar-outline" x={-1.5} y={barTop - 1.5} width={w + 3} height={barH + 3} rx={rx + 1.5} style={{ width: `${w + 3}px` }} />
      {s.features.labels && inside && (
        <text class="bar-label inside" x={9} y={cy + 4} fill={hasProgress && (progress ?? 0) < 40 ? 'var(--text)' : undefined}>
          {label}
        </text>
      )}
      {/* Zonas de interacción */}
      <rect class="bar-hit" x={0} y={barTop} width={w} height={barH} onPointerDown={beginDrag(r, 'move')} style={{ width: `${w}px` }} />
      {w > 14 && (
        <>
          <rect class="handle" x={-3} y={barTop} width={9} height={barH} onPointerDown={beginDrag(r, 'resize-start')} />
          <rect class="handle" x={w - 6} y={barTop} width={9} height={barH} onPointerDown={beginDrag(r, 'resize-end')} />
          <rect class="handle-mark" x={3} y={cy - 5} width={2} height={10} rx={1} />
          <rect class="handle-mark" x={w - 5} y={cy - 5} width={2} height={10} rx={1} />
        </>
      )}
      <circle class="link-dot" cx={w + 10} cy={cy} r={5} onPointerDown={beginLink(r)}>
        <title>Arrastrá hasta otra tarea para crear una dependencia</title>
      </circle>
      <Avatars owners={owners} x0={ox} cy={cy} />
      {s.features.labels && !inside && <text class="bar-label outside" x={labelX} y={cy + 4}>{label}</text>}
    </g>
  );
}

function Summary({ r, common, w, rowH, s, px, rangeStart, bx, beginDrag }: {
  r: Row; common: Common; w: number; rowH: number; s: ViewSettings; px: number; rangeStart: Day; bx: number;
  beginDrag: (r: Row, m: DragMode) => (e: PointerEvent) => void;
}) {
  const cy = rowH / 2;
  const h = r.kind === 'section' ? 10 : 8;
  const top = cy - h / 2;
  const cap = 5;
  const isSection = r.kind === 'section';
  return (
    <g {...common}>
      <rect class="summary-bar" x={0} y={top} width={w} height={h} rx={2} fill={r.color} opacity={isSection ? 0.85 : 0.75} style={{ width: `${w}px` }} />
      <path d={`M0 ${top + h} l0 ${cap} l${cap} -${cap} z`} fill={r.color} opacity={isSection ? 0.85 : 0.75} />
      <path class="summary-cap" d={`M0 ${top + h} l0 ${cap} l-${cap} -${cap} z`} fill={r.color} opacity={isSection ? 0.85 : 0.75} style={{ transform: `translateX(${w}px)` }} />
      {r.innerMilestones.map((m, i) => {
        const mx = (m.day - rangeStart) * px - bx;
        return (
          <rect key={i} class="inner-ms" x={mx - 5} y={cy - 5} width={10} height={10} rx={1.5} fill="var(--text)" stroke="var(--surface)" stroke-width={1.5} transform={`rotate(45 ${mx} ${cy})`}>
            <title>{m.label}</title>
          </rect>
        );
      })}
      <rect
        class="bar-hit"
        x={0}
        y={top - 5}
        width={w}
        height={h + 10}
        onPointerDown={r.task ? beginDrag(r, 'move') : undefined}
        style={{ width: `${w}px`, cursor: 'pointer' }}
      >
        <title>{r.folded ? 'Doble clic para expandir' : 'Doble clic para colapsar'}</title>
      </rect>
      {s.features.labels && (
        <text class="bar-label outside summary" x={w + 12} y={cy + 4}>
          {r.label}
        </text>
      )}
    </g>
  );
}

function Milestone({ r, common, size, rowH, s, beginDrag, beginLink }: {
  r: Row; common: Common; size: number; rowH: number; s: ViewSettings;
  beginDrag: (r: Row, m: DragMode) => (e: PointerEvent) => void;
  beginLink: (r: Row) => (e: PointerEvent) => void;
}) {
  const cy = rowH / 2;
  const half = size * 0.5;
  const color = r.task?.spec.color ?? (r.task?.critical ? 'var(--danger)' : 'var(--text)');
  return (
    <g {...common}>
      <rect class="bar-outline" x={-half - 2} y={cy - half - 2} width={size + 4} height={size + 4} rx={3} transform={`rotate(45 0 ${cy})`} />
      <rect class="milestone" x={-half} y={cy - half} width={size} height={size} rx={2.5} fill={color} transform={`rotate(45 0 ${cy})`} />
      <rect class="bar-hit" x={-half - 2} y={cy - half - 2} width={size + 4} height={size + 4} onPointerDown={beginDrag(r, 'move')} />
      <circle class="link-dot" cx={half + 10} cy={cy} r={5} onPointerDown={beginLink(r)} />
      {s.features.labels && (
        <text class="bar-label outside" x={half + 22} y={cy + 4} font-weight="600">
          {r.label}
        </text>
      )}
    </g>
  );
}

function DepPath({ dep, span, x, rowH, barH, highlighted, selected, onSelect, onDelete }: {
  dep: DepLink;
  span: (r: Row) => { start: Day; end: Day };
  x: (d: Day) => number;
  rowH: number;
  barH: number;
  highlighted: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const a = span(dep.from);
  const b = span(dep.to);
  const fromMs = !!dep.from.task?.spec.milestone;
  const toMs = !!dep.to.task?.spec.milestone;
  const fromSummary = !!dep.from.task?.children.length;
  const x1 = fromMs ? x(a.start) + barH / 2 + 1 : x(a.end) + (fromSummary ? 5 : 0);
  const y1 = dep.from.y + rowH / 2;
  const x2 = toMs ? x(b.start) - barH / 2 - 3 : x(b.start) - 2;
  const y2 = dep.to.y + rowH / 2;
  const { d, mid } = depRoute({ x1, y1, x2, y2, toRowTop: dep.to.y, rowH });
  const cls = ['dep-group', dep.critical ? 'crit' : '', highlighted ? 'hl' : '', selected ? 'selected' : '', dep.dimmed ? 'dimmed' : ''].join(' ');
  const marker = highlighted || selected ? 'url(#arrow-hl)' : dep.critical ? 'url(#arrow-crit)' : 'url(#arrow)';
  return (
    <g class={cls}>
      <path class="dep" d={d} style={{ d: `path("${d}")` }} marker-end={marker} />
      {(highlighted || selected) && <path class="dep-flow" d={d} style={{ d: `path("${d}")` }} />}
      <path
        class="dep-hit"
        d={d}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          if (!presenting.value) onDelete();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (presenting.value) return;
          onSelect();
          openDepMenu(e, dep);
        }}
      >
        <title>{`${dep.from.label} → ${dep.to.label}\nClic: seleccionar · Doble clic o Supr: quitar`}</title>
      </path>
      {selected && !presenting.value && (
        <g class="dep-del" onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}>
          <circle cx={mid[0]} cy={mid[1]} r={9} fill="var(--danger)" stroke="var(--surface)" stroke-width={2} />
          <path d={`M ${mid[0] - 3} ${mid[1] - 3} L ${mid[0] + 3} ${mid[1] + 3} M ${mid[0] + 3} ${mid[1] - 3} L ${mid[0] - 3} ${mid[1] + 3}`} stroke="#fff" stroke-width={1.8} stroke-linecap="round" />
        </g>
      )}
    </g>
  );
}
