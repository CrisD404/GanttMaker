import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { COLOR_BYS, COLUMNS, DENSITIES, FEATURES, type Feature, type Scale } from '../core/types';
import {
  addSection, addTaskToSection, createView, deleteView, renameView, setColorBy, setDensity, setDetail,
  setFeatureVisible, setScale, toggleColumn,
} from '../state/actions';
import { activeView, currentView, doc, fitProject, scrollToDay, setZoom, settings, today, zoom } from '../state/store';
import { MenuItems, Popover, Segmented, Toggle } from '../ui/controls';
import { Icon } from '../ui/icons';
import { COLUMN_LABELS, openTabMenu, SprintConfig } from './menus';

const SCALE_OPTS: { value: Scale; label: string; title: string }[] = [
  { value: 'day', label: 'Día', title: 'Escala diaria (1)' },
  { value: 'week', label: 'Semana', title: 'Escala semanal (2)' },
  { value: 'sprint', label: 'Sprint', title: 'Escala por sprints (3) · configurable con clic derecho en el encabezado' },
  { value: 'month', label: 'Mes', title: 'Escala mensual (4)' },
  { value: 'quarter', label: 'Trim.', title: 'Escala trimestral (5)' },
  { value: 'year', label: 'Año', title: 'Escala anual (6)' },
];

const DETAIL_OPTS = [
  { value: 1, label: 'Secciones', title: 'detail sections' },
  { value: 2, label: 'Tareas', title: 'detail tasks' },
  { value: 3, label: 'Subtareas', title: 'detail subtasks' },
  { value: 99, label: 'Todo', title: 'detail all' },
];

const FEATURE_LABELS: Record<Feature, string> = {
  deps: 'Dependencias',
  today: 'Línea de hoy',
  weekends: 'Días no laborables',
  progress: 'Avance en barras',
  avatars: 'Avatares',
  labels: 'Etiquetas de barras',
  grid: 'Grilla',
  sprints: 'Sprints (bandas y fila)',
};
const DENSITY_LABELS = { compact: 'Compacta', normal: 'Normal', comfortable: 'Amplia' };
const COLOR_LABELS = { owner: 'Responsable', section: 'Sección', status: 'Estado' };

export function GanttToolbar() {
  const s = settings.value;
  const detail = s.detail >= 99 ? 99 : Math.min(s.detail, 3);
  return (
    <div class="gantt-toolbar">
      <ViewTabs />
      <div class="ctrl-group">
        <Segmented options={SCALE_OPTS} value={s.scale} onChange={setScale} title="Escala de tiempo" />
      </div>
      <div class="ctrl-group hide-sm">
        <Segmented options={DETAIL_OPTS} value={detail} onChange={setDetail} title="Nivel de detalle" />
      </div>
      <DisplayMenu />
      <div class="ctrl-group">
        <button class="icon-btn" title="Alejar (−) · también Ctrl + rueda" onClick={() => setZoom(zoom.value / 1.25)}>
          <Icon name="zoomOut" />
        </button>
        {zoom.value !== 1 && (
          <button class="zoom-val btn ghost sm" title="Restablecer zoom (0)" onClick={() => setZoom(1)} style={{ padding: 0, animation: 'pop-scale var(--dur) var(--ease-spring)' }}>
            {Math.round(zoom.value * 100)}%
          </button>
        )}
        <button class="icon-btn" title="Acercar (+) · también Ctrl + rueda" onClick={() => setZoom(zoom.value * 1.25)}>
          <Icon name="zoomIn" />
        </button>
        <button class="icon-btn" title="Ajustar al proyecto (Shift+1)" onClick={fitProject}>
          <Icon name="focus" />
        </button>
        <button class="btn sm" title="Ir a hoy (T)" onClick={() => scrollToDay(today)}>Hoy</button>
      </div>
    </div>
  );
}

export function AddMenu() {
  return (
    <Popover
      align="left"
      trigger={(open, toggle) => (
        <button class={`btn sm ${open ? 'on' : ''}`} onClick={toggle} title="Agregar tarea, sección o vista">
          <Icon name="plus" size={14} /> Agregar
        </button>
      )}
    >
      {(close) => {
        const sections = doc.value.sections;
        return (
          <MenuItems
            close={close}
            items={[
              ...sections.map((sec) => ({
                label: `Tarea en ${sec.name || 'el proyecto'}`,
                icon: <span class="dot" style={{ background: sec.color }} />,
                onClick: () => addTaskToSection(sec.key),
              })),
              ...(sections.length ? [{ separator: true }] : []),
              { label: 'Nueva sección', icon: <Icon name="layers" size={14} />, onClick: addSection },
              { label: 'Nueva vista', icon: <Icon name="eye" size={14} />, onClick: () => createView() },
              { separator: true },
              { heading: 'Tip: doble clic en el gráfico crea una tarea en esa fecha' },
            ]}
          />
        );
      }}
    </Popover>
  );
}

function ViewTabs() {
  const views = doc.value.views;
  const current = currentView.value;
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.tab.on');
    setInd(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [current, views.map((v) => v.name).join('|'), editing]);

  const tabs: { name: string | null; label: string }[] = [
    { name: null, label: 'Principal' },
    ...views.map((v) => ({ name: v.name, label: v.name })),
  ];

  return (
    <div
      class="tabs"
      ref={ref}
      role="tablist"
      onDblClick={(e) => {
        // Doble clic en el espacio libre de la barra de pestañas → nueva vista
        if (e.target === ref.current) createView();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.name ?? '__main'}
          class={`tab ${current === tab.name ? 'on' : ''}`}
          role="tab"
          aria-selected={current === tab.name}
          onClick={() => (activeView.value = tab.name)}
          onDblClick={(e) => {
            e.stopPropagation();
            if (tab.name) setEditing(tab.name);
          }}
          onContextMenu={(e) => openTabMenu(e, tab.name, () => tab.name && setEditing(tab.name))}
          title={tab.name ? 'Doble clic: renombrar · Clic derecho: más' : 'Vista principal: ajustes de nivel superior'}
        >
          {tab.name === null && <Icon name="layers" size={13} />}
          {editing === tab.name && tab.name ? (
            <input
              autoFocus
              defaultValue={tab.name}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
              onBlur={(e) => {
                renameView(tab.name!, (e.target as HTMLInputElement).value);
                setEditing(null);
              }}
              ref={(el) => {
                if (el) setTimeout(() => el.select(), 0);
              }}
            />
          ) : (
            tab.label
          )}
          {tab.name && editing !== tab.name && current === tab.name && (
            <span
              class="tab-x icon-btn sm"
              role="button"
              title="Eliminar vista"
              onClick={(e) => {
                e.stopPropagation();
                deleteView(tab.name!);
              }}
            >
              <Icon name="x" size={12} />
            </span>
          )}
        </button>
      ))}
      <button class="icon-btn sm" title="Nueva vista (o doble clic en el espacio libre)" onClick={() => createView()}>
        <Icon name="plus" size={14} />
      </button>
      {ind && <div class="tab-indicator" style={{ left: ind.left + 8, width: Math.max(0, ind.width - 16) }} />}
    </div>
  );
}

function DisplayMenu() {
  const s = settings.value;
  return (
    <Popover
      trigger={(open, toggle) => (
        <button class={`btn sm ${open ? 'on' : ''}`} onClick={toggle} title="Personalizar la vista">
          <Icon name="sliders" size={14} /> Vista
        </button>
      )}
    >
      {() => (
        <div style={{ width: 300, maxHeight: '72vh', overflowY: 'auto' }}>
          <div class="menu-title">
            Personalizar · {currentView.value ?? 'Principal'}
          </div>
          <div style={{ padding: '0 10px 6px', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Los cambios se escriben en el código de esta vista. Los filtros están en el dock de abajo.
          </div>
          <div class="menu-sep" />
          <div class="menu-title">Mostrar</div>
          {FEATURES.map((f) => (
            <div class="menu-row" key={f}>
              {FEATURE_LABELS[f]}
              <Toggle on={s.features[f]} onChange={(v) => setFeatureVisible(f, v)} label={FEATURE_LABELS[f]} />
            </div>
          ))}
          <div class="menu-sep" />
          <div class="menu-title">Columnas</div>
          {COLUMNS.map((c) => (
            <div class="menu-row" key={c}>
              {COLUMN_LABELS[c]}
              <Toggle on={s.columns.includes(c)} onChange={(v) => toggleColumn(c, v)} label={COLUMN_LABELS[c]} />
            </div>
          ))}
          <div class="menu-sep" />
          <div class="menu-title">Densidad</div>
          <div style={{ padding: '2px 10px 8px' }}>
            <Segmented options={DENSITIES.map((x) => ({ value: x, label: DENSITY_LABELS[x] }))} value={s.density} onChange={setDensity} />
          </div>
          <div class="menu-title">Color de barras por</div>
          <div style={{ padding: '2px 10px 8px' }}>
            <Segmented options={COLOR_BYS.map((x) => ({ value: x, label: COLOR_LABELS[x] }))} value={s.colorBy} onChange={setColorBy} />
          </div>
          <div class="menu-sep" />
          <div class="menu-title">Sprints</div>
          <SprintConfig />
        </div>
      )}
    </Popover>
  );
}
