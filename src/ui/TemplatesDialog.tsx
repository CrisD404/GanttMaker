import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { compile } from '../core/index';
import { hasSprints } from '../core/sprints';
import { resolveView } from '../core/views';
import { exportSvg } from '../io/export';
import { BASE_PX_PER_DAY } from '../render/layout';
import { createSpace, theme, toast, today, uniqueSpaceTitle } from '../state/store';
import { TEMPLATES, type Template } from '../templates';
import { Icon } from './icons';

export const templatesDialogOpen = signal(false);

/** Crea un espacio nuevo a partir de una plantilla. */
export function applyTemplate(t: Template) {
  const base = compile(t.text, today).title || t.title;
  createSpace(t.text, { title: uniqueSpaceTitle(base) });
  toast(`Nuevo espacio desde la plantilla "${t.title}"`, 'success');
}

export function newSpaceFrom(id: string) {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
  applyTemplate(t);
}

const previewCache = new Map<string, string>();

/** Vista previa del gantt como imagen SVG (con zoom para que entre todo el proyecto). */
function preview(t: Template, mode: 'light' | 'dark', width: number): string {
  const key = `${t.id}|${mode}|${width}`;
  const hit = previewCache.get(key);
  if (hit) return hit;
  const d = compile(t.text, today);
  const s = resolveView(d, null);
  const tasks = d.tasks.length ? d.tasks : [];
  const span = tasks.length ? Math.max(...tasks.map((x) => x.end)) - Math.min(...tasks.map((x) => x.start)) : 30;
  const zoom = width / (span + 14) / BASE_PX_PER_DAY[s.scale];
  const { svg } = exportSvg({
    doc: d,
    settings: { ...s, density: 'compact', features: { ...s.features, avatars: false } },
    collapsed: new Set(),
    zoom,
    today,
    theme: mode,
    viewName: null,
    compact: true,
  });
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  previewCache.set(key, url);
  return url;
}

function stats(t: Template) {
  const d = compile(t.text, today);
  const leaves = d.tasks.filter((x) => !x.children.length);
  const start = Math.min(...d.tasks.map((x) => x.start));
  const end = Math.max(...d.tasks.map((x) => x.end));
  return {
    sections: d.sections.filter((s) => s.line >= 0).length,
    tasks: leaves.filter((x) => !x.spec.milestone).length,
    milestones: leaves.filter((x) => x.spec.milestone).length,
    owners: d.owners.size,
    views: d.views.map((v) => v.name),
    weeks: Math.max(1, Math.round((end - start) / 7)),
    sprints: hasSprints(d),
  };
}

export function TemplatesDialog() {
  const [selected, setSelected] = useState<Template>(TEMPLATES[1] ?? TEMPLATES[0]);
  const [closing, setClosing] = useState(false);
  const mode = theme.value;
  const info = useMemo(() => stats(selected), [selected]);

  const close = () => {
    setClosing(true);
    setTimeout(() => {
      templatesDialogOpen.value = false;
      setClosing(false);
    }, 160);
  };
  const use = (t: Template) => {
    applyTemplate(t);
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) use(selected);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = TEMPLATES.indexOf(selected);
        const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        setSelected(TEMPLATES[(i + step + TEMPLATES.length) % TEMPLATES.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <>
      <div class="drawer-overlay" onClick={close} style={closing ? { opacity: 0, transition: 'opacity 160ms' } : undefined} />
      <div class={`dialog templates-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-label="Plantillas">
        <div class="dialog-head">
          <div class="brand-logo"><Icon name="template" size={16} style={{ color: '#fff' }} /></div>
          <div>
            <h2>Plantillas</h2>
            <p>Casos de uso típicos listos para adaptar. Se abren en un espacio nuevo.</p>
          </div>
          <span class="spacer" />
          <button class="icon-btn" onClick={close} title="Cerrar (Esc)"><Icon name="x" /></button>
        </div>
        <div class="tpl-layout">
          <div class="tpl-grid" role="listbox" aria-label="Plantillas">
            {TEMPLATES.map((t, i) => (
              <button
                key={t.id}
                class={`tpl-card ${selected.id === t.id ? 'on' : ''}`}
                style={{ animationDelay: `${i * 40}ms` }}
                role="option"
                aria-selected={selected.id === t.id}
                onClick={() => setSelected(t)}
                onDblClick={() => use(t)}
                title="Doble clic para usarla"
              >
                <div class="tpl-thumb">
                  <img src={preview(t, mode, 520)} alt="" loading="lazy" draggable={false} />
                </div>
                <div class="tpl-card-body">
                  <Icon name={t.icon} size={15} />
                  <span>{t.title}</span>
                </div>
              </button>
            ))}
          </div>
          <aside class="tpl-detail" key={selected.id}>
            <div class="tpl-preview">
              <img src={preview(selected, mode, 900)} alt={`Vista previa: ${selected.title}`} draggable={false} />
            </div>
            <h3>{selected.title}</h3>
            <p>{selected.description}</p>
            <div class="tpl-features">
              {selected.features.map((f) => <span key={f} class="tpl-chip">{f}</span>)}
            </div>
            <div class="tpl-stats">
              <div><b>{info.sections}</b><span>secciones</span></div>
              <div><b>{info.tasks}</b><span>tareas</span></div>
              <div><b>{info.milestones}</b><span>hitos</span></div>
              <div><b>{info.owners}</b><span>responsables</span></div>
              <div><b>{info.weeks}</b><span>semanas</span></div>
            </div>
            {info.views.length > 0 && (
              <p class="tpl-views">
                <Icon name="eye" size={13} /> Vistas: {info.views.join(' · ')}
                {info.sprints && ' · con sprints'}
              </p>
            )}
            <div class="tpl-actions">
              <button class="btn primary" onClick={() => use(selected)}>
                <Icon name="plus" size={14} /> Usar esta plantilla
              </button>
              <span class="hint-text">Enter · doble clic en la tarjeta</span>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
