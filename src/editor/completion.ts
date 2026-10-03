import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';
import { COLOR_BYS, COLUMNS, DENSITIES, FEATURES, SCALES, STATUS_TAGS, type GanttDoc } from '../core/types';
import { PALETTE } from '../core/parser';

const TOP: Completion[] = [
  snippetCompletion('gantt "${Título}"', { label: 'gantt', detail: 'título del diagrama', type: 'keyword' }),
  snippetCompletion('start ${2026-01-05}', { label: 'start', detail: 'fecha de inicio del proyecto', type: 'keyword' }),
  snippetCompletion('today ${2026-01-05}', { label: 'today', detail: 'fija la fecha de "hoy"', type: 'keyword' }),
  snippetCompletion('calendar ${mon-fri}', { label: 'calendar', detail: 'días laborables', type: 'keyword' }),
  snippetCompletion('holiday ${2026-12-25}', { label: 'holiday', detail: 'feriados (fechas o rangos)', type: 'keyword' }),
  snippetCompletion('sprints ${2w}', { label: 'sprints', detail: 'cadencia: 2w from AAAA-MM-DD "Sprint {n}" first 1', type: 'keyword' }),
  snippetCompletion('sprint "${Nombre}" ${2026-01-05..2026-01-16}', { label: 'sprint', detail: 'sprint con fechas propias', type: 'keyword' }),
  snippetCompletion('team ${Nombre} ${#5b5bf7}', { label: 'team', detail: 'declara un equipo', type: 'keyword' }),
  snippetCompletion('person ${Nombre} @${Equipo}', { label: 'person', detail: 'declara una persona', type: 'keyword' }),
  snippetCompletion('section ${Nombre}\n  ${Tarea} 3d', { label: 'section', detail: 'agrupa tareas', type: 'keyword' }),
  snippetCompletion('view ${Nombre}\n  scale ${month}\n  detail ${sections}', { label: 'view', detail: 'vista personalizada', type: 'keyword' }),
];

const SETTINGS: Completion[] = [
  { label: 'scale', detail: SCALES.join(' | '), type: 'property', apply: 'scale ' },
  { label: 'detail', detail: 'sections | tasks | subtasks | all | n', type: 'property', apply: 'detail ' },
  { label: 'columns', detail: COLUMNS.join(', ') + ', none', type: 'property', apply: 'columns ' },
  { label: 'show', detail: FEATURES.join(', '), type: 'property', apply: 'show ' },
  { label: 'hide', detail: FEATURES.join(', '), type: 'property', apply: 'hide ' },
  { label: 'density', detail: DENSITIES.join(' | '), type: 'property', apply: 'density ' },
  { label: 'filter', detail: '@responsable #etiqueta "texto"', type: 'property', apply: 'filter ' },
  { label: 'range', detail: 'AAAA-MM-DD..AAAA-MM-DD', type: 'property', apply: 'range ' },
  { label: 'color', detail: COLOR_BYS.join(' | '), type: 'property', apply: 'color ' },
];

const VALUES: Record<string, Completion[]> = {
  scale: SCALES.map((s) => ({ label: s, type: 'enum' })),
  detail: [
    { label: 'sections', detail: 'solo secciones', type: 'enum' },
    { label: 'tasks', detail: 'secciones y tareas', type: 'enum' },
    { label: 'subtasks', detail: 'hasta subtareas', type: 'enum' },
    { label: 'all', detail: 'todo', type: 'enum' },
  ],
  density: DENSITIES.map((s) => ({ label: s, type: 'enum' })),
  color: COLOR_BYS.map((s) => ({ label: s, type: 'enum' })),
  columns: [...COLUMNS, 'none'].map((s) => ({ label: s, type: 'enum' })),
  show: [...FEATURES, 'all'].map((s) => ({ label: s, type: 'enum' })),
  hide: [...FEATURES, 'all'].map((s) => ({ label: s, type: 'enum' })),
  calendar: ['mon-fri', 'mon-sat', 'all'].map((s) => ({ label: s, type: 'enum' })),
};

const STATUS_INFO: Record<string, string> = {
  done: 'terminada',
  active: 'en curso',
  blocked: 'bloqueada',
  crit: 'crítica',
};

function inView(ctx: CompletionContext, lineNo: number): boolean {
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = ctx.state.doc.line(n).text;
    if (!text.trim() || /^\s*\/\//.test(text)) continue;
    if (/^\S/.test(text)) return /^view\b/i.test(text);
  }
  return false;
}

export function ganttCompletion(getDoc: () => GanttDoc) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const doc = getDoc();

    // Responsables
    let m = /@("?[^\s,"]*)$/.exec(before);
    if (m) {
      return {
        from: ctx.pos - m[0].length,
        options: [...doc.owners.values()].map((o) => ({
          label: /\s/.test(o.name) ? `@"${o.name}"` : `@${o.name}`,
          detail: o.kind === 'team' ? 'equipo' : o.team ? `persona · ${o.team}` : 'persona',
          type: o.kind === 'team' ? 'class' : 'variable',
        })),
        validFor: /^@"?[^\s,"]*$/,
      };
    }

    // Etiquetas, estados y colores
    m = /#([\w-]*)$/.exec(before);
    if (m) {
      const tags = new Set<string>();
      doc.tasks.forEach((t) => t.spec.tags.forEach((x) => tags.add(x)));
      const options: Completion[] = [
        ...[...STATUS_TAGS, 'crit'].map((s) => ({ label: `#${s}`, detail: STATUS_INFO[s], type: 'keyword', boost: 2 })),
        ...[...tags].filter((t) => !STATUS_INFO[t]).map((t) => ({ label: `#${t}`, type: 'text' })),
        ...PALETTE.map((c) => ({ label: c, detail: 'color', type: 'constant', boost: -1 })),
      ];
      return { from: ctx.pos - m[0].length, options, validFor: /^#[\w-]*$/ };
    }

    // Referencias de `after`
    m = /\bafter\s+(?:[^@#]*,\s*)?([^,@#]*)$/i.exec(before);
    if (m) {
      return {
        from: ctx.pos - m[1].length,
        options: doc.tasks.map((t) => ({
          label: t.spec.id ?? t.spec.name,
          detail: t.section.name,
          type: t.spec.milestone ? 'constant' : 'function',
        })),
      };
    }

    // Valores de ajustes
    m = /^\s*(scale|detail|density|color|columns|show|hide|calendar)\s+(?:.*[,\s])?([\w-]*)$/i.exec(before);
    if (m) {
      return { from: ctx.pos - m[2].length, options: VALUES[m[1].toLowerCase()] ?? [], validFor: /^[\w-]*$/ };
    }

    // Primera palabra de la línea
    m = /^(\s*)(\w*)$/.exec(before);
    if (m && (m[2] || ctx.explicit)) {
      const indent = m[1].length;
      if (indent === 0) return { from: ctx.pos - m[2].length, options: [...TOP, ...SETTINGS], validFor: /^\w*$/ };
      if (inView(ctx, line.number)) return { from: ctx.pos - m[2].length, options: SETTINGS, validFor: /^\w*$/ };
    }
    return null;
  };
}
