import { useMemo, useRef, useState } from 'preact/hooks';
import { compile } from '../core/index';
import { downloadBackup, pickFile } from '../io/files';
import {
  currentSpaceId, deleteSpace, duplicateSpace, openContextMenu, renameSpace, spaces, spaceText, switchSpace,
  today, type SpaceMeta,
} from '../state/store';
import { TEMPLATES } from '../templates';
import { Popover } from './controls';
import { Icon } from './icons';
import { newSpaceFrom, templatesDialogOpen } from './TemplatesDialog';

export { newSpaceFrom };

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(ts).toLocaleDateString('es');
}

/** Mini vista previa del diagrama (hasta 7 barras). */
function Thumb({ id }: { id: string }) {
  const bars = useMemo(() => {
    const d = compile(spaceText(id), today);
    const ts = d.tasks.filter((t) => !t.children.length).slice(0, 7);
    if (!ts.length) return [];
    const min = Math.min(...ts.map((t) => t.start));
    const max = Math.max(...ts.map((t) => t.end), min + 1);
    const colorOf = (t: (typeof ts)[number]) => t.spec.color ?? d.owners.get(t.spec.owners[0]?.toLowerCase() ?? '')?.color ?? t.section.color ?? '#94a3b8';
    return ts.map((t, i) => ({
      x: ((t.start - min) / (max - min)) * 40 + 2,
      w: t.spec.milestone ? 3 : Math.max(3, ((t.end - t.start) / (max - min)) * 40),
      y: 3 + i * 4.4,
      c: colorOf(t),
      ms: t.spec.milestone,
    }));
  }, [id, spaces.value.find((m) => m.id === id)?.updated]);
  return (
    <svg class="space-thumb" width="44" height="36" viewBox="0 0 44 36">
      {bars.map((b, i) => (b.ms
        ? <rect key={i} x={b.x} y={b.y} width={3} height={3} fill="var(--text)" transform={`rotate(45 ${b.x + 1.5} ${b.y + 1.5})`} />
        : <rect key={i} x={b.x} y={b.y} width={b.w} height={3} rx={1.5} fill={b.c} />))}
    </svg>
  );
}

function SpaceItem({ m, close }: { m: SpaceMeta; close: () => void }) {
  const [editing, setEditing] = useState(false);
  const current = m.id === currentSpaceId.value;
  const inputRef = useRef<HTMLInputElement>(null);
  const menu = (e: MouseEvent) =>
    openContextMenu(e, [
      { label: 'Abrir', icon: <Icon name="chevronRight" size={14} />, onClick: () => { switchSpace(m.id); close(); } },
      { label: 'Renombrar', icon: <Icon name="edit" size={14} />, onClick: () => setEditing(true) },
      { label: 'Duplicar', icon: <Icon name="copy" size={14} />, onClick: () => duplicateSpace(m.id) },
      { separator: true },
      { label: 'Eliminar', icon: <Icon name="trash" size={14} />, danger: true, onClick: () => deleteSpace(m.id) },
    ]);
  return (
    <div
      class={`space-item ${current ? 'current' : ''}`}
      onClick={() => {
        if (editing) return;
        switchSpace(m.id);
        close();
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        menu(e);
      }}
    >
      <Thumb id={m.id} />
      <div class="space-info">
        {editing ? (
          <input
            ref={(el) => {
              inputRef.current = el;
              if (el && document.activeElement !== el) {
                el.focus();
                el.select();
              }
            }}
            class="name-input"
            defaultValue={m.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={(e) => {
              renameSpace(m.id, (e.target as HTMLInputElement).value);
              setEditing(false);
            }}
          />
        ) : (
          <div class="space-title">{m.title}</div>
        )}
        <div class="space-meta">
          {m.tasks} tarea{m.tasks === 1 ? '' : 's'} · {relativeTime(m.updated)}
        </div>
      </div>
      <div class="space-actions" onClick={(e) => e.stopPropagation()}>
        <button class="icon-btn sm" title="Renombrar" onClick={() => setEditing(true)}><Icon name="edit" size={13} /></button>
        <button class="icon-btn sm" title="Duplicar" onClick={() => duplicateSpace(m.id)}><Icon name="copy" size={13} /></button>
        <button class="icon-btn sm" title="Eliminar" onClick={() => deleteSpace(m.id)}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

export function SpacesMenu() {
  const [q, setQ] = useState('');
  const list = [...spaces.value]
    .sort((a, b) => b.updated - a.updated)
    .filter((m) => !q.trim() || m.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover
      align="left"
      trigger={(open, toggle) => (
        <button class={`btn sm ghost spaces-btn ${open ? 'on' : ''}`} onClick={toggle} title="Espacios: tus diagramas guardados en este navegador">
          <Icon name="grid" size={14} />
          <span class="hide-sm">Espacios</span>
          <span class="dock-badge">{spaces.value.length}</span>
        </button>
      )}
    >
      {(close) => (
        <div class="spaces">
          <div class="spaces-head">
            <div class="menu-title" style={{ padding: 0 }}>Espacios</div>
            <span class="spacer" />
            <span class="hint-text">Se guardan en este navegador</span>
          </div>
          {spaces.value.length > 5 && (
            <label class="dock-search spaces-search">
              <Icon name="search" size={14} />
              <input placeholder="Buscar espacio…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          )}
          <div class="spaces-list">
            {list.map((m) => <SpaceItem key={m.id} m={m} close={close} />)}
            {!list.length && <div class="hint-text" style={{ padding: 12 }}>No hay espacios con ese nombre</div>}
          </div>
          <div class="menu-sep" />
          <div class="menu-title">Nuevo espacio</div>
          <div class="templates">
            <button class="template" onClick={() => { newSpaceFrom('blank'); close(); }}>
              <Icon name="filePlus" size={16} />
              <span>
                <b>En blanco</b>
                <small>Una sección y un par de tareas para empezar</small>
              </span>
            </button>
            <button class="template" onClick={() => { templatesDialogOpen.value = true; close(); }}>
              <Icon name="template" size={16} />
              <span>
                <b>Plantillas…</b>
                <small>{TEMPLATES.length - 1} casos de uso con vista previa: producto, eventos, obra, marketing…</small>
              </span>
              <Icon name="chevronRight" size={14} class="template-go" />
            </button>
          </div>
          <div class="menu-sep" />
          <div class="spaces-backup">
            <span class="hint-text">Copia de seguridad</span>
            <span class="spacer" />
            <button class="btn sm ghost" onClick={() => { downloadBackup(); close(); }} title="Descargar todos los espacios (.json)">
              <Icon name="download" size={13} /> Exportar
            </button>
            <button class="btn sm ghost" onClick={() => { pickFile('.json,application/json'); close(); }} title="Importar espacios desde un .json">
              <Icon name="upload" size={13} /> Importar
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
