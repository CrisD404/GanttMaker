// Contenido de los menús contextuales según dónde se hizo clic derecho.
import { useState } from 'preact/hooks';
import { formatShort, parseIso, toIso, type Day } from '../core/dates';
import { PALETTE } from '../core/parser';
import { cadenceAnchor, defaultCadence, serializeCadence } from '../core/sprints';
import { COLUMNS, SCALES, type Column, type Scale } from '../core/types';
import { deleteSection, removeDependency } from '../core/writer';
import type { DepLink, Row, Tick } from '../render/layout';
import {
  addMilestoneAfter, addSection, addSubtask, addTaskAfter, addTaskToSection, createTaskAt, createView, deleteTask,
  deleteView, duplicateTask, goToCode, patchTask, selectTask, setScale, setSprints, setStatus, startRename,
  toggleCollapse, toggleColumn, toggleCritical, toggleQuickOwner,
} from '../state/actions';
import {
  activeView, doc, edit, fitPeriod, fitProject, openContextMenu, scrollToDay, settings, source, today, toastUndo, type MenuEntry,
} from '../state/store';
import { Segmented } from '../ui/controls';
import { Icon } from '../ui/icons';
import { DateInput } from '../ui/inputs';

export const SCALE_LABELS: Record<Scale, string> = {
  day: 'Día', week: 'Semana', sprint: 'Sprint', month: 'Mes', quarter: 'Trimestre', year: 'Año',
};
export const COLUMN_LABELS: Record<Column, string> = {
  owner: 'Responsable', start: 'Inicio', end: 'Fin', duration: 'Duración', progress: 'Avance',
};

const ic = (name: string) => <Icon name={name} size={14} />;

function colorRow(current: string | undefined, onPick: (c: string | undefined) => void): MenuEntry {
  return {
    custom: (close) => (
      <div class="menu-swatches">
        <button class={`swatch auto ${!current ? 'on' : ''}`} title="Color automático" onClick={() => { close(); onPick(undefined); }} />
        {PALETTE.map((c) => (
          <button key={c} class={`swatch ${current === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => { close(); onPick(c); }} />
        ))}
      </div>
    ),
  };
}

export function openTaskMenu(e: MouseEvent, row: Row) {
  const t = row.task!;
  selectTask(row.key);
  const owners = t.spec.owners;
  const items: MenuEntry[] = [
    { label: 'Editar…', icon: ic('sliders'), hint: 'Enter', onClick: () => selectTask(row.key, { open: true }) },
    { label: 'Renombrar', icon: ic('code'), hint: 'F2', onClick: () => startRename(row.key, 'grid') },
    { label: 'Ir al código', icon: ic('code'), onClick: () => goToCode(row.key) },
    { separator: true },
    { label: 'Tarea debajo', icon: ic('rowBelow'), hint: 'Alt+Enter', onClick: () => addTaskAfter(row.key) },
    { label: 'Subtarea', icon: ic('subtask'), onClick: () => addSubtask(row.key) },
    { label: 'Hito debajo', icon: ic('diamond'), onClick: () => addMilestoneAfter(row.key) },
    { label: 'Duplicar', icon: ic('copy'), hint: 'Ctrl+D', onClick: () => duplicateTask(row.key) },
    { separator: true },
  ];
  if (!t.spec.milestone && !t.children.length) {
    items.push(
      { label: 'En curso', checked: t.status === 'active', onClick: () => setStatus(row.key, t.status === 'active' ? null : 'active') },
      { label: 'Hecha', checked: t.status === 'done', onClick: () => setStatus(row.key, t.status === 'done' ? null : 'done') },
      { label: 'Bloqueada', checked: t.status === 'blocked', onClick: () => setStatus(row.key, t.status === 'blocked' ? null : 'blocked') },
    );
  }
  items.push({ label: 'Crítica', checked: t.critical, onClick: () => toggleCritical(row.key) });
  if (t.deps.length) {
    items.push({ label: 'Quitar dependencias', icon: ic('unlink'), onClick: () => { patchTask(row.key, { after: [] }); toastUndo('Dependencias quitadas'); } });
  }
  if (owners.length) {
    items.push({ label: `Filtrar por ${owners[0]}`, icon: ic('users'), onClick: () => toggleQuickOwner(owners[0]) });
  }
  items.push(
    { heading: 'Color' },
    colorRow(t.spec.color, (c) => patchTask(row.key, { color: c })),
    { separator: true },
    { label: 'Eliminar', icon: ic('trash'), hint: 'Supr', danger: true, onClick: () => deleteTask(row.key) },
  );
  openContextMenu(e, items);
}

export function openSectionMenu(e: MouseEvent, row: Row, onRename: () => void) {
  const s = row.section;
  const explicitColor = s.line >= 0 ? /\s(#(?:[0-9a-f]{6}|[0-9a-f]{3}))(?=\s|$)/i.exec(source.value.split('\n')[s.line] ?? '')?.[1] : undefined;
  openContextMenu(e, [
    { label: 'Agregar tarea', icon: ic('plus'), onClick: () => addTaskToSection(row.key) },
    { label: 'Renombrar sección', icon: ic('code'), onClick: onRename },
    { label: row.folded ? 'Expandir' : 'Colapsar', icon: ic('chevron'), onClick: () => toggleCollapse(row.key) },
    { label: 'Ajustar zoom a la sección', icon: ic('focus'), onClick: () => fitPeriod(row.start, row.end) },
    { label: 'Nueva sección', icon: ic('layers'), onClick: () => addSection() },
    { heading: 'Color' },
    colorRow(explicitColor, (c) => recolorSection(row, c)),
    { separator: true },
    {
      label: 'Eliminar sección',
      icon: ic('trash'),
      danger: true,
      onClick: () => {
        edit((text, d) => deleteSection(text, d, row.key));
        toastUndo(`Sección "${row.label}" eliminada`);
      },
    },
  ]);
}

function recolorSection(row: Row, color: string | undefined) {
  edit((text, d) => {
    const s = d.sections.find((x) => x.key === row.key);
    if (!s || s.line < 0) return text;
    const ls = text.split('\n');
    const base = ls[s.line].replace(/\s+#(?:[0-9a-f]{6}|[0-9a-f]{3})(?=\s|$)/i, '');
    ls[s.line] = color ? `${base} ${color}` : base;
    return ls.join('\n');
  });
}

export function openChartMenu(e: MouseEvent, day: Day, near: { kind: 'task' | 'section'; key: string } | null) {
  const s = settings.value;
  openContextMenu(e, [
    { label: `Nueva tarea el ${formatShort(day)}`, icon: ic('plus'), hint: 'doble clic', onClick: () => createTaskAt(day, near) },
    { label: `Nuevo hito el ${formatShort(day)}`, icon: ic('diamond'), onClick: () => createTaskAt(day, near, true) },
    { label: 'Nueva sección', icon: ic('layers'), onClick: () => addSection() },
    { separator: true },
    { label: 'Ir a hoy', icon: ic('calendar'), hint: 'T', onClick: () => scrollToDay(today) },
    { label: 'Ajustar al proyecto', icon: ic('focus'), hint: 'Shift+1', onClick: fitProject },
    { heading: 'Escala' },
    ...SCALES.map((sc) => ({ label: SCALE_LABELS[sc], checked: s.scale === sc, onClick: () => setScale(sc) })),
  ]);
}

export function openDepMenu(e: MouseEvent, dep: DepLink) {
  const from = dep.from, to = dep.to;
  openContextMenu(e, [
    { heading: `${from.label} → ${to.label}` },
    { label: `Ir a "${from.label}"`, icon: ic('chevronRight'), onClick: () => { selectTask(from.key); scrollToDay(from.start); } },
    { label: `Ir a "${to.label}"`, icon: ic('chevronRight'), onClick: () => { selectTask(to.key); scrollToDay(to.start); } },
    { separator: true },
    {
      label: 'Quitar dependencia',
      icon: ic('unlink'),
      hint: 'doble clic',
      danger: true,
      onClick: () => {
        edit((text, d) => removeDependency(text, d, from.key, to.key));
        toastUndo('Dependencia eliminada');
      },
    },
  ]);
}

export function openHeaderMenu(e: MouseEvent, tick: Tick | null) {
  const s = settings.value;
  const items: MenuEntry[] = [];
  if (tick) {
    items.push(
      { label: `Ajustar a ${tick.label}`, icon: ic('focus'), hint: 'doble clic', onClick: () => fitPeriod(tick.start, tick.end) },
      { separator: true },
    );
  }
  items.push(
    { label: 'Ajustar al proyecto', icon: ic('focus'), hint: 'Shift+1', onClick: fitProject },
    { label: 'Ir a hoy', icon: ic('calendar'), hint: 'T', onClick: () => scrollToDay(today) },
    { heading: 'Escala' },
    ...SCALES.map((sc) => ({ label: SCALE_LABELS[sc], checked: s.scale === sc, onClick: () => setScale(sc) })),
    { separator: true },
    { heading: 'Sprints' },
    { custom: (close) => <SprintConfig onDone={close} /> },
  );
  openContextMenu(e, items);
}

export function openTabMenu(e: MouseEvent, name: string | null, onRename: () => void) {
  const items: MenuEntry[] = [];
  if (name) {
    items.push(
      { label: 'Renombrar', icon: ic('code'), hint: 'doble clic', onClick: onRename },
      { label: 'Duplicar vista', icon: ic('copy'), onClick: () => createView(name) },
      { separator: true },
      { label: 'Eliminar vista', icon: ic('trash'), danger: true, onClick: () => deleteView(name) },
    );
  } else {
    items.push({ label: 'Nueva vista', icon: ic('plus'), onClick: () => createView() });
  }
  activeView.value = name;
  openContextMenu(e, items);
}

export function openColumnsMenu(e: MouseEvent) {
  const cols = settings.value.columns;
  openContextMenu(e, [
    { heading: 'Columnas' },
    ...COLUMNS.map((c) => ({ label: COLUMN_LABELS[c], checked: cols.includes(c), onClick: () => toggleColumn(c, !cols.includes(c)) })),
  ]);
}

export function openOwnerMenu(e: MouseEvent, owner: string) {
  openContextMenu(e, [
    { label: `Filtrar por ${owner}`, icon: ic('users'), hint: 'doble clic', onClick: () => toggleQuickOwner(owner) },
  ]);
}

// ---------------------------------------------------------------------------

/** Configuración de sprints: escribe la línea `sprints` del código. */
export function SprintConfig({ onDone }: { onDone?: () => void }) {
  const d = doc.value;
  const c = d.sprintCadence ?? defaultCadence();
  const explicit = d.sprintList.length > 0;
  const [len, setLen] = useState(c.lengthText.toLowerCase());
  const [from, setFrom] = useState(toIso(cadenceAnchor(d, c)));
  const [pattern, setPattern] = useState(c.pattern);
  const [first, setFirst] = useState(c.first);
  const apply = () => {
    // Si la fecha es la que se usaría por defecto, no hace falta escribir "from"
    const defaultFrom = toIso(cadenceAnchor(d, { ...c, from: null }));
    const fromValue = parseIso(from) !== null && (from !== defaultFrom || d.sprintCadence?.from != null) ? from : null;
    setSprints(serializeCadence({ lengthText: len, from: fromValue, pattern, first }));
    if (settings.value.scale !== 'sprint') setScale('sprint');
    onDone?.();
  };
  return (
    <div class="sprint-config" onKeyDown={(e) => e.stopPropagation()}>
      {explicit && <div class="hint-text">Este diagrama usa sprints explícitos (<code>sprint …</code>). La cadencia se ignora mientras existan.</div>}
      <div class="field">
        <label>Duración</label>
        <Segmented
          options={['1w', '2w', '3w', '4w'].map((v) => ({ value: v, label: `${v[0]} sem` }))}
          value={len}
          onChange={setLen}
        />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Primer sprint</label>
          <DateInput value={from} calendar={d.calendar} onChange={setFrom} />
        </div>
        <div class="field" style={{ maxWidth: 76 }}>
          <label>N.º</label>
          <input class="input" type="number" min={0} value={first} onInput={(e) => setFirst(Math.max(0, +(e.target as HTMLInputElement).value || 0))} />
        </div>
      </div>
      <div class="field">
        <label>Nombre <span class="badge">{'{n}'} = número</span></label>
        <input class="input" value={pattern} onInput={(e) => setPattern((e.target as HTMLInputElement).value)} />
      </div>
      <div class="field-row" style={{ justifyContent: 'space-between' }}>
        {d.sprintCadence ? (
          <button class="btn sm ghost danger" style={{ flex: 'none' }} onClick={() => { setSprints(null); onDone?.(); }}>Quitar sprints</button>
        ) : <span />}
        <button class="btn sm primary" style={{ flex: 'none' }} onClick={apply}>Aplicar</button>
      </div>
    </div>
  );
}
