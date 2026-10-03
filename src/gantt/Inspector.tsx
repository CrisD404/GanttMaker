import { useState } from 'preact/hooks';
import { countWorkdays, parseIso, toIso } from '../core/dates';
import { PALETTE } from '../core/parser';
import { refOf, wouldCreateCycle } from '../core/schedule';
import { CRIT_TAG, STATUS_TAGS, type Status, type TaskNode } from '../core/types';
import { moveTaskToSection, retimeTask } from '../core/writer';
import {
  addSubtask, addTaskAfter, deleteTask, duplicateTask, patchTask, setStatus, toggleCritical,
} from '../state/actions';
import { doc, edit, inspectorOpen, selectedTask } from '../state/store';
import { Segmented, Toggle, initials } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Autocomplete, DateInput, Select, type Suggestion } from '../ui/inputs';

const STATUS_OPTIONS: { value: Status | 'none'; label: string }[] = [
  { value: 'none', label: 'Pendiente' },
  { value: 'active', label: 'En curso' },
  { value: 'done', label: 'Hecha' },
  { value: 'blocked', label: 'Bloqueada' },
];

export function Inspector() {
  const t = selectedTask.value;
  const d = doc.value;
  const [closing, setClosing] = useState(false);
  if (!t) return null;

  const close = () => {
    setClosing(true);
    setTimeout(() => (inspectorOpen.value = false), 200);
  };

  const isParent = t.children.length > 0;
  const spec = t.spec;
  const days = countWorkdays(d.calendar, t.start, t.end);
  const otherTags = spec.tags.filter((x) => x !== CRIT_TAG && !(STATUS_TAGS as readonly string[]).includes(x));
  const depCandidates = d.tasks.filter((x) => x !== t && !t.deps.includes(x) && !wouldCreateCycle(x, t));

  return (
    <aside class={`inspector ${closing ? 'closing' : ''}`} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div class="insp-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="crumb">{t.section.name || 'Tarea'}{t.parent ? ` › ${t.parent.spec.name}` : ''}</div>
        </div>
        <button class="icon-btn sm" title="Cerrar (Esc)" onClick={close}><Icon name="x" size={15} /></button>
      </div>

      <div class="insp-body">
        <div class="field">
          <label>Nombre</label>
          <TextField value={spec.name} onCommit={(v) => v && patchTask(t.key, { name: v })} />
        </div>

        {d.sections.length > 1 && t.depth === 0 && (
          <div class="field">
            <label>Sección</label>
            <Select
              value={t.section.key}
              options={d.sections.map((s) => ({ value: s.key, label: s.name || '(sin sección)', icon: <span class="dot" style={{ background: s.color }} /> }))}
              onChange={(key) => edit((text, doc) => moveTaskToSection(text, doc, t.key, key))}
            />
          </div>
        )}

        <div class="field">
          <label><Icon name="users" size={12} /> Responsables</label>
          <Owners t={t} />
        </div>

        <div class="field-row">
          <div class="field" style={{ flex: 1.3 }}>
            <label>
              {spec.milestone ? 'Fecha' : 'Inicio'}
              {!spec.start && !isParent && <span class="badge" title="Calculada por dependencias u orden">auto</span>}
              {spec.start && !isParent && (
                <button class="link-btn" title="Volver a calcularla automáticamente" onClick={() => patchTask(t.key, { start: undefined, end: undefined })}>
                  auto
                </button>
              )}
            </label>
            <DateInput
              value={toIso(t.start)}
              calendar={d.calendar}
              disabled={isParent}
              onChange={(iso) => {
                const day = parseIso(iso);
                if (day === null) return;
                edit((text, doc) => retimeTask(text, doc, t.key, day, day + (t.end - t.start), 'move'));
              }}
            />
          </div>
          {!spec.milestone && (
            <div class="field" style={{ flex: 1 }}>
              <label>Días hábiles</label>
              <NumberStepper
                value={days}
                min={1}
                disabled={isParent}
                onChange={(n) => patchTask(t.key, { duration: { n, unit: 'd' }, end: undefined })}
              />
            </div>
          )}
        </div>

        {!isParent && (
          <div class="menu-row" style={{ padding: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="diamond" size={14} /> Es un hito</span>
            <Toggle
              on={spec.milestone}
              onChange={(v) => patchTask(t.key, v ? { milestone: true, duration: undefined, end: undefined, progress: undefined } : { milestone: false, duration: { n: 1, unit: 'd' } })}
              label="Hito"
            />
          </div>
        )}

        <div class="field">
          <label><Icon name="link" size={12} /> Empieza después de</label>
          <div class="chips">
            {t.deps.map((dep) => (
              <span class="chip plain" key={dep.key}>
                {dep.spec.name}
                <button
                  title="Quitar dependencia"
                  onClick={() => patchTask(t.key, { after: spec.after.filter((r) => r !== refOf(dep) && r.toLowerCase() !== dep.spec.name.toLowerCase()) })}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
            <Select
              value={null}
              className="chip-select"
              searchable
              triggerLabel={<><Icon name="plus" size={12} /> Agregar</>}
              options={depCandidates.map((x) => ({
                value: x.key,
                label: x.spec.name,
                group: x.section.name || 'Tareas',
                depth: x.depth,
                icon: x.spec.milestone ? <span class="dot ms" style={{ background: 'var(--text)' }} /> : undefined,
              }))}
              onChange={(key) => {
                const dep = d.tasks.find((x) => x.key === key);
                if (dep) patchTask(t.key, { after: [...spec.after, refOf(dep)] });
              }}
            />
          </div>
        </div>

        {!spec.milestone && !isParent && (
          <>
            <div class="field">
              <label>Estado</label>
              <Segmented
                options={STATUS_OPTIONS}
                value={t.status ?? 'none'}
                onChange={(v) => setStatus(t.key, v === 'none' ? null : (v as Status))}
              />
            </div>
            <div class="field">
              <label>Avance <span class="badge">{spec.progress ?? 0}%</span></label>
              <ProgressSlider key={spec.progress ?? 0} value={spec.progress ?? 0} onCommit={(p) => patchTask(t.key, { progress: p })} />
            </div>
          </>
        )}

        <div class="menu-row" style={{ padding: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="sparkle" size={14} /> Crítica</span>
          <Toggle on={t.critical} onChange={() => toggleCritical(t.key)} label="Crítica" />
        </div>

        <div class="field">
          <label>Etiquetas</label>
          <ChipList
            values={otherTags}
            placeholder="+ etiqueta"
            onChange={(tags) => patchTask(t.key, { tags: [...spec.tags.filter((x) => !otherTags.includes(x)), ...tags.map((x) => x.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'))] })}
          />
        </div>

        <div class="field">
          <label>Color</label>
          <div class="swatches">
            <button class={`swatch auto ${!spec.color ? 'on' : ''}`} title="Automático (según la vista)" onClick={() => patchTask(t.key, { color: undefined })} />
            {PALETTE.map((c) => (
              <button key={c} class={`swatch ${spec.color === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => patchTask(t.key, { color: c })} />
            ))}
          </div>
        </div>
      </div>

      <div class="insp-foot">
        <button class="btn sm" onClick={() => addTaskAfter(t.key)}><Icon name="rowBelow" size={13} /> Tarea debajo</button>
        <button class="btn sm" onClick={() => addSubtask(t.key)}><Icon name="subtask" size={13} /> Subtarea</button>
        <button class="btn sm" onClick={() => duplicateTask(t.key)} title="Duplicar"><Icon name="copy" size={13} /></button>
        <span class="spacer" />
        <button class="btn sm danger" onClick={() => deleteTask(t.key)} title="Eliminar"><Icon name="trash" size={13} /></button>
      </div>
    </aside>
  );
}

function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return (
    <input
      class="input"
      value={value}
      key={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => {
        const v = (e.target as HTMLInputElement).value.trim();
        if (v !== value) onCommit(v);
      }}
    />
  );
}

function ProgressSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      class="range"
      type="range"
      min={0}
      max={100}
      step={5}
      value={v}
      style={{ '--p': `${v}%` } as Record<string, string>}
      onInput={(e) => setV(+(e.target as HTMLInputElement).value)}
      onChange={(e) => onCommit(+(e.target as HTMLInputElement).value)}
    />
  );
}

function Owners({ t }: { t: TaskNode }) {
  const d = doc.value;
  const owners = t.spec.owners;
  const all = [...d.owners.values()];
  return (
    <div class="chips">
      {owners.map((name) => {
        const o = d.owners.get(name.toLowerCase());
        return (
          <span class="chip" key={name}>
            <span class={`avatar ${o?.kind === 'team' ? 'team' : ''}`} style={{ background: o?.color ?? '#94a3b8', width: 18, height: 18, fontSize: 8 }}>{initials(name)}</span>
            {name}
            <button title="Quitar" onClick={() => patchTask(t.key, { owners: owners.filter((x) => x !== name) })}><Icon name="x" size={11} /></button>
          </span>
        );
      })}
      <Autocomplete
        placeholder="+ persona o equipo"
        clearOnSubmit
        suggestions={ownerSuggestions(all.filter((o) => !owners.includes(o.name)))}
        onSubmit={(raw) => {
          const v = raw.trim().replace(/^@/, '');
          if (!v || owners.some((x) => x.toLowerCase() === v.toLowerCase())) return;
          const existing = d.owners.get(v.toLowerCase());
          patchTask(t.key, { owners: [...owners, existing?.name ?? v] });
        }}
      />
    </div>
  );
}

/** Sugerencias de responsables con avatar y tipo. */
export function ownerSuggestions(list: { name: string; kind: string; color: string; team?: string }[]): Suggestion[] {
  return list.map((o) => ({
    value: o.name,
    hint: o.kind === 'team' ? 'Equipo' : o.team ? `Persona · ${o.team}` : 'Persona',
    icon: <span class={`avatar ${o.kind === 'team' ? 'team' : ''}`} style={{ background: o.color, width: 18, height: 18, fontSize: 8 }}>{initials(o.name)}</span>,
  }));
}

/** Número con botones − / + (los spinners nativos no respetan el tema). */
function NumberStepper({ value, min = 0, max = 9999, disabled, onChange }: { value: number; min?: number; max?: number; disabled?: boolean; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div class={`stepper ${disabled ? 'disabled' : ''}`}>
      <button type="button" class="icon-btn sm" disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))} aria-label="Menos">
        <Icon name="minus" size={13} />
      </button>
      <input
        class="input"
        type="number"
        min={min}
        value={value}
        key={value}
        disabled={disabled}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => {
          const n = clamp(+(e.target as HTMLInputElement).value || min);
          if (n !== value) onChange(n);
        }}
      />
      <button type="button" class="icon-btn sm" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))} aria-label="Más">
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

function ChipList({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div class="chips">
      {values.map((v) => (
        <span class="chip plain" key={v}>
          #{v}
          <button onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={11} /></button>
        </span>
      ))}
      <input
        class="chip-input"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const input = e.target as HTMLInputElement;
          const v = input.value.trim();
          if (v && !values.includes(v)) onChange([...values, v]);
          input.value = '';
        }}
      />
    </div>
  );
}
