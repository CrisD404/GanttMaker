import { DEFAULT_CALENDAR, parseIso, parseWorkdays } from './dates';
import {
  DATE_RE, DURATION_RE, HEX_RE, PROGRESS_RE, RANGE_RE,
  isAttrToken, slugify, splitComment, tokenize, type Token,
} from './lexer';
import {
  COLOR_BYS, COLUMNS, DENSITIES, FEATURES, SCALES,
  type Column, type ColorBy, type Density, type Diagnostic, type Feature, type GanttDoc,
  type Owner, type Scale, type SectionNode, type SettingKey, type TaskNode, type TaskSpec,
  type ViewDef, type ViewOverrides,
} from './types';

/** Paleta por defecto: buena legibilidad en tema claro y oscuro. */
export const PALETTE = [
  '#5b5bf7', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6',
  '#0ea5e9', '#22c55e', '#ef4444', '#f97316', '#64748b',
];

const HEADER_KEYWORDS = new Set(['gantt', 'title', 'start', 'today', 'calendar', 'holiday', 'holidays', 'sprints', 'sprint']);
const SETTING_KEYWORDS = new Set<string>(['scale', 'detail', 'columns', 'show', 'hide', 'density', 'filter', 'range', 'color']);

export const DETAIL_NAMES: Record<string, number> = { sections: 1, tasks: 2, subtasks: 3, all: 99 };

function measureIndent(s: string): number {
  let n = 0;
  for (const c of s) n += c === '\t' ? 4 : 1;
  return n;
}

function joinValues(toks: Token[]): string {
  return toks.map((t) => t.value).join(' ').trim();
}

export function parse(text: string): GanttDoc {
  const lines = text.split(/\r?\n/);
  const diags: Diagnostic[] = [];
  const doc: GanttDoc = {
    title: '',
    titleLine: -1,
    projectStart: null,
    startLine: -1,
    today: null,
    anchor: 0,
    calendar: { workdays: [...DEFAULT_CALENDAR.workdays], holidays: new Set() },
    sprintCadence: null,
    sprintList: [],
    owners: new Map(),
    sections: [],
    tasks: [],
    views: [],
    base: {},
    baseSettingLines: {},
    headerEnd: -1,
    diagnostics: diags,
    lineCount: lines.length,
  };

  const err = (line: number, t: { from: number; to: number } | null, message: string, severity: 'error' | 'warning' = 'error') => {
    const from = t ? t.from : 0;
    const to = t ? t.to : lines[line].length;
    diags.push({ line, from, to, message, severity });
  };

  let section: SectionNode | null = null;
  let view: ViewDef | null = null;
  let stack: { indent: number; task: TaskNode }[] = [];
  let headerDone = false;
  const keyCounts = new Map<string, number>();
  const usedOwnerColors: string[] = [];
  const explicitColor = new Set<Owner>();

  const ensureSection = (): SectionNode => {
    if (!section) {
      section = { key: 's:', name: '', line: -1, tasks: [], start: 0, end: 0 };
      doc.sections.push(section);
    }
    return section;
  };

  for (let i = 0; i < lines.length; i++) {
    const { code, comment } = splitComment(lines[i]);
    if (!code.trim()) continue;
    const indentStr = /^\s*/.exec(code)![0];
    const indent = measureIndent(indentStr);
    const toks = tokenize(code);
    const first = toks[0];
    const kw = first.quoted ? '' : first.value.toLowerCase();
    const rest = toks.slice(1);

    // --- Bloque `view` -----------------------------------------------------
    if (view) {
      if (indent > 0) {
        const r = parseSetting(kw, toks, i, view.overrides, view.settingLines, err);
        if (r === 'notsetting') err(i, first, `Ajuste de vista desconocido: "${first.value}". Usá scale, detail, columns, show, hide, density, filter, range o color.`);
        view.endLine = i;
        continue;
      }
      view = null;
    }

    // --- Palabras clave de nivel superior ------------------------------------
    const canBeKeyword = indent === 0 || !section;
    if (canBeKeyword) {
      if (HEADER_KEYWORDS.has(kw)) {
        const handled = parseHeader(kw, rest, i, doc, err, !!section);
        if (handled) {
          if (!headerDone) doc.headerEnd = i;
          continue;
        }
      } else if (kw === 'team' || kw === 'person') {
        headerDone = true;
        const o = parseOwner(kw, rest, i, doc, err, usedOwnerColors);
        if (o?.explicit) explicitColor.add(o.owner);
        continue;
      } else if (kw === 'section') {
        headerDone = true;
        const colorTok = rest.find((t) => HEX_RE.test(t.value));
        const name = joinValues(rest.filter((t) => t !== colorTok));
        const key = 's:' + slugify(name || `seccion-${doc.sections.length + 1}`);
        section = { key, name: name || `Sección ${doc.sections.length + 1}`, line: i, tasks: [], start: 0, end: 0, color: colorTok?.value };
        doc.sections.push(section);
        stack = [];
        continue;
      } else if (kw === 'view') {
        headerDone = true;
        const name = joinValues(rest);
        if (!name) err(i, first, 'La vista necesita un nombre: view Ejecutivo');
        if (doc.views.some((v) => v.name.toLowerCase() === name.toLowerCase())) err(i, first, `Ya existe una vista llamada "${name}"`, 'warning');
        view = { name: name || `Vista ${doc.views.length + 1}`, line: i, endLine: i, overrides: {}, settingLines: {} };
        doc.views.push(view);
        continue;
      } else if (SETTING_KEYWORDS.has(kw)) {
        const r = parseSetting(kw, toks, i, doc.base, doc.baseSettingLines, section ? null : err);
        if (r === 'ok' || !section) {
          if (!headerDone) doc.headerEnd = i;
          continue;
        }
        // Dentro de una sección, si el ajuste no es válido lo tratamos como tarea ("Show demo 2d").
      }
    }

    // --- Tarea ---------------------------------------------------------------
    headerDone = true;
    const sec = ensureSection();
    const spec = parseTaskTokens(toks, i, err);
    if (!spec) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].task : null;

    const baseKey = 't:' + slugify(spec.id ?? spec.name);
    const count = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, count + 1);

    const node: TaskNode = {
      key: count ? `${baseKey}~${count}` : baseKey,
      spec,
      line: i,
      indent: indentStr,
      comment,
      depth: parent ? parent.depth + 1 : 0,
      parent,
      children: [],
      section: sec,
      start: 0,
      end: 0,
      deps: [],
      status: null,
      critical: false,
    };
    if (parent) parent.children.push(node);
    else sec.tasks.push(node);
    doc.tasks.push(node);
    stack.push({ indent, task: node });
  }

  // Las personas sin color propio usan el color de su equipo
  for (const o of doc.owners.values()) {
    if (o.kind !== 'person' || !o.team || explicitColor.has(o)) continue;
    const team = doc.owners.get(o.team.toLowerCase());
    if (team) o.color = team.color;
  }

  // Colores de secciones sin color propio
  doc.sections.forEach((s, idx) => {
    if (!s.color) s.color = PALETTE[idx % PALETTE.length];
  });

  return doc;
}

type ErrFn = (line: number, t: { from: number; to: number } | null, message: string, severity?: 'error' | 'warning') => void;

function parseHeader(kw: string, rest: Token[], i: number, doc: GanttDoc, err: ErrFn, inSection: boolean): boolean {
  switch (kw) {
    case 'gantt':
    case 'title':
      doc.title = joinValues(rest);
      doc.titleLine = i;
      return true;
    case 'start':
    case 'today': {
      const d = rest.length === 1 ? parseIso(rest[0].value) : null;
      if (d === null) {
        if (inSection) return false;
        err(i, rest[0] ?? null, `"${kw}" espera una fecha AAAA-MM-DD, por ejemplo: ${kw} 2026-11-02`);
        return true;
      }
      if (kw === 'start') {
        doc.projectStart = d;
        doc.startLine = i;
      } else doc.today = d;
      return true;
    }
    case 'calendar': {
      const wd = parseWorkdays(joinValues(rest));
      if (!wd) {
        if (inSection) return false;
        err(i, rest[0] ?? null, 'Calendario inválido. Ejemplos: calendar mon-fri · calendar all · calendar mon,tue,thu');
        return true;
      }
      doc.calendar.workdays = wd;
      return true;
    }
    case 'sprints':
      return parseSprintCadence(rest, i, doc, err, inSection);
    case 'sprint':
      return parseSprint(rest, i, doc, err, inSection);
    case 'holiday':
    case 'holidays': {
      if (!rest.length) {
        if (inSection) return false;
        err(i, null, 'Indicá una o más fechas: holiday 2026-12-25, 2026-12-31');
        return true;
      }
      for (const part of joinValues(rest).split(/[\s,]+/).filter(Boolean)) {
        const range = RANGE_RE.exec(part);
        if (range) {
          const a = parseIso(range[1]), b = parseIso(range[2]);
          if (a === null || b === null || b < a) {
            err(i, null, `Rango de feriados inválido: ${part}`);
            continue;
          }
          for (let d = a; d <= b; d++) doc.calendar.holidays.add(d);
        } else {
          const d = parseIso(part);
          if (d === null) {
            if (inSection) return false;
            err(i, null, `Fecha de feriado inválida: ${part}`);
          } else doc.calendar.holidays.add(d);
        }
      }
      return true;
    }
  }
  return false;
}

/** Duración de sprint en días corridos: "2w" → 14, "10d" → 10. */
function sprintLength(v: string): number | null {
  const m = DURATION_RE.exec(v);
  if (!m || +m[1] <= 0) return null;
  return m[2].toLowerCase() === 'w' ? +m[1] * 7 : +m[1];
}

/** `sprints 2w [from 2026-10-05] ["Sprint {n}"] [first 14]` */
function parseSprintCadence(rest: Token[], i: number, doc: GanttDoc, err: ErrFn, inSection: boolean): boolean {
  const length = rest[0] ? sprintLength(rest[0].value) : null;
  if (length === null) {
    if (inSection) return false;
    err(i, rest[0] ?? null, 'Indicá la duración del sprint: sprints 2w (semanas) o sprints 10d (días corridos)');
    return true;
  }
  const cad = { length, lengthText: rest[0].value, from: null as number | null, pattern: 'Sprint {n}', first: 1, line: i };
  for (let k = 1; k < rest.length; k++) {
    const t = rest[k];
    const low = t.value.toLowerCase();
    if (t.quoted) cad.pattern = t.value;
    else if (low === 'from') {
      const d = rest[k + 1] ? parseIso(rest[k + 1].value) : null;
      if (d === null) err(i, rest[k + 1] ?? t, '"from" espera una fecha: from 2026-10-05');
      else cad.from = d;
      k++;
    } else if (low === 'first') {
      const n = rest[k + 1] && /^\d+$/.test(rest[k + 1].value) ? +rest[k + 1].value : null;
      if (n === null) err(i, rest[k + 1] ?? t, '"first" espera un número: first 14');
      else cad.first = n;
      k++;
    } else {
      err(i, t, `No se reconoce "${t.value}". Formato: sprints 2w from 2026-10-05 "Sprint {n}" first 1`, 'warning');
    }
  }
  if (doc.sprintCadence) err(i, null, 'Ya hay una línea "sprints"; se usa la última', 'warning');
  doc.sprintCadence = cad;
  return true;
}

/** `sprint "Nombre" 2026-10-05..2026-10-16` · `sprint Hardening 2026-12-01 1w` */
function parseSprint(rest: Token[], i: number, doc: GanttDoc, err: ErrFn, inSection: boolean): boolean {
  const nameToks: Token[] = [];
  let k = 0;
  while (k < rest.length && !DATE_RE.test(rest[k].value) && !RANGE_RE.test(rest[k].value)) nameToks.push(rest[k++]);
  const name = joinValues(nameToks) || `Sprint ${doc.sprintList.length + 1}`;
  let start: number | null = null;
  let end: number | null = null;
  const t = rest[k];
  if (t && RANGE_RE.test(t.value)) {
    const m = RANGE_RE.exec(t.value)!;
    start = parseIso(m[1]);
    end = parseIso(m[2]);
    end = end === null ? null : end + 1;
  } else if (t && DATE_RE.test(t.value)) {
    start = parseIso(t.value);
    const next = rest[k + 1];
    const len = next ? sprintLength(next.value) : null;
    const endDate = next && DATE_RE.test(next.value) ? parseIso(next.value) : null;
    if (start !== null && len !== null) end = start + len;
    else if (endDate !== null) end = endDate + 1;
  }
  if (start === null || end === null || end <= start) {
    if (inSection) return false;
    err(i, t ?? null, 'Sprint inválido. Ej.: sprint "Sprint 1" 2026-10-05..2026-10-16 · sprint Hardening 2026-12-01 1w');
    return true;
  }
  doc.sprintList.push({ name, start, end, line: i });
  return true;
}

function parseOwner(kw: 'team' | 'person', rest: Token[], i: number, doc: GanttDoc, err: ErrFn, used: string[]): { owner: Owner; explicit: boolean } | null {
  let color: string | undefined;
  let team: string | undefined;
  const nameToks: Token[] = [];
  for (const t of rest) {
    if (HEX_RE.test(t.value)) color = t.value;
    else if (t.value.startsWith('@')) team = t.value.slice(1);
    else nameToks.push(t);
  }
  const name = joinValues(nameToks);
  if (!name) {
    err(i, null, `Falta el nombre: ${kw} ${kw === 'team' ? 'Backend #4f8cff' : 'Ana @Backend'}`);
    return null;
  }
  const key = name.toLowerCase();
  if (doc.owners.has(key)) err(i, nameToks[0], `"${name}" ya fue declarado`, 'warning');
  if (kw === 'team' && team) err(i, null, 'Un equipo no puede pertenecer a otro equipo', 'warning');
  const explicit = !!color;
  if (!color) {
    // Las personas con equipo heredan su color al final del parseo; no consumen paleta
    color = kw === 'person' && team ? PALETTE[0] : PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
  }
  if (explicit || !(kw === 'person' && team)) used.push(color);
  const owner: Owner = { name, kind: kw, color, team: kw === 'person' ? team : undefined, line: i };
  doc.owners.set(key, owner);
  return { owner, explicit };
}

function parseList(toks: Token[]): string[] {
  return joinValues(toks).split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Devuelve 'ok', 'invalid' (era un ajuste pero con valor erróneo) o 'notsetting'. */
export function parseSetting(
  kw: string,
  toks: Token[],
  i: number,
  target: ViewOverrides,
  lines: Partial<Record<SettingKey, number>>,
  err: ErrFn | null,
): 'ok' | 'invalid' | 'notsetting' {
  const rest = toks.slice(1);
  const fail = (msg: string) => {
    err?.(i, rest[0] ?? toks[0], msg);
    return 'invalid' as const;
  };
  switch (kw) {
    case 'scale': {
      const v = rest[0]?.value.toLowerCase() as Scale;
      if (!SCALES.includes(v) || rest.length !== 1) return fail(`Escala inválida. Opciones: ${SCALES.join(', ')}`);
      target.scale = v;
      break;
    }
    case 'color': {
      const v = rest[0]?.value.toLowerCase() as ColorBy;
      if (!COLOR_BYS.includes(v) || rest.length !== 1) return fail(`"color" acepta: ${COLOR_BYS.join(', ')}`);
      target.colorBy = v;
      break;
    }
    case 'detail': {
      const v = rest[0]?.value.toLowerCase() ?? '';
      const n = DETAIL_NAMES[v] ?? (/^\d+$/.test(v) ? Math.max(1, +v) : NaN);
      if (Number.isNaN(n) || rest.length !== 1) return fail('Nivel de detalle inválido. Opciones: sections, tasks, subtasks, all o un número (1, 2, 3…)');
      target.detail = n;
      break;
    }
    case 'density': {
      const v = rest[0]?.value.toLowerCase() as Density;
      if (!DENSITIES.includes(v) || rest.length !== 1) return fail(`Densidad inválida. Opciones: ${DENSITIES.join(', ')}`);
      target.density = v;
      break;
    }
    case 'columns': {
      const items = parseList(rest);
      if (!items.length) return fail(`Indicá columnas: ${COLUMNS.join(', ')} o none`);
      if (items.length === 1 && items[0] === 'none') {
        target.columns = [];
        break;
      }
      const bad = items.filter((c) => !COLUMNS.includes(c as Column));
      if (bad.length) return fail(`Columna desconocida: ${bad.join(', ')}. Opciones: ${COLUMNS.join(', ')}, none`);
      target.columns = items as Column[];
      break;
    }
    case 'show':
    case 'hide': {
      let items = parseList(rest);
      if (items.length === 1 && items[0] === 'all') items = [...FEATURES];
      if (!items.length) return fail(`Indicá elementos: ${FEATURES.join(', ')} o all`);
      const bad = items.filter((c) => !FEATURES.includes(c as Feature));
      if (bad.length) return fail(`Elemento desconocido: ${bad.join(', ')}. Opciones: ${FEATURES.join(', ')}, all`);
      target[kw] = items as Feature[];
      break;
    }
    case 'filter': {
      const owners: string[] = [];
      const tags: string[] = [];
      const words: string[] = [];
      for (const t of rest) {
        if (t.quoted && !/^[@#]/.test(t.raw)) {
          words.push(t.value);
          continue;
        }
        for (const part of t.value.split(',').filter(Boolean)) {
          if (part.startsWith('@')) owners.push(part.slice(1));
          else if (part.startsWith('#')) tags.push(part.slice(1).toLowerCase());
          else if (part.toLowerCase() !== 'none') return fail('El filtro usa @responsable, #etiqueta o "texto entre comillas". Ej.: filter @Backend #crit "pagos"');
        }
      }
      target.filter = { owners, tags, text: words.join(' ') };
      break;
    }
    case 'range': {
      const vals = rest.map((t) => t.value).join(' ');
      const m = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|->|\s)\s*(\d{4}-\d{2}-\d{2})$/.exec(vals);
      const a = m ? parseIso(m[1]) : null;
      const b = m ? parseIso(m[2]) : null;
      if (a === null || b === null || b < a) return fail('Rango inválido. Ej.: range 2026-11-01..2026-12-31');
      target.range = [a, b + 1];
      break;
    }
    default:
      return 'notsetting';
  }
  lines[kw as SettingKey] = i;
  return 'ok';
}

export function parseTaskTokens(toks: Token[], i: number, err: ErrFn): TaskSpec | null {
  const spec: TaskSpec = { name: '', owners: [], tags: [], after: [], milestone: false };
  let k = 0;
  const nameParts: string[] = [];
  if (toks[0].quoted && !/^[@#]/.test(toks[0].raw)) {
    nameParts.push(toks[0].value);
    k = 1;
  } else {
    while (k < toks.length && !isAttrToken(toks[k])) nameParts.push(toks[k++].value);
  }
  spec.name = nameParts.join(' ').trim();
  if (!spec.name) {
    err(i, toks[0], 'La tarea necesita un nombre antes de sus atributos. Ej.: Diseño @Ana 5d');
    return null;
  }

  let dateCount = 0;
  while (k < toks.length) {
    const t = toks[k];
    const v = t.value;
    const lower = v.toLowerCase();
    if (v.startsWith('@')) {
      for (const o of v.split(',')) {
        const name = o.replace(/^@/, '').trim();
        if (name) spec.owners.push(name);
      }
    } else if (HEX_RE.test(v)) {
      spec.color = v;
    } else if (v.startsWith('#')) {
      for (const tag of v.split(',')) {
        const name = tag.replace(/^#/, '').trim().toLowerCase();
        if (name && !spec.tags.includes(name)) spec.tags.push(name);
      }
    } else if (DURATION_RE.test(v)) {
      const m = DURATION_RE.exec(v)!;
      spec.duration = { n: +m[1], unit: m[2].toLowerCase() as 'd' | 'w' };
      if (spec.duration.n === 0) spec.milestone = true;
    } else if (PROGRESS_RE.test(v)) {
      const p = +PROGRESS_RE.exec(v)![1];
      if (p > 100) err(i, t, 'El avance no puede superar 100%', 'warning');
      spec.progress = Math.min(100, p);
    } else if (RANGE_RE.test(v)) {
      const m = RANGE_RE.exec(v)!;
      if (parseIso(m[1]) === null || parseIso(m[2]) === null) err(i, t, `Fecha inválida en ${v}`);
      else {
        spec.start = m[1];
        spec.end = m[2];
        dateCount = 2;
      }
    } else if (DATE_RE.test(v)) {
      if (parseIso(v) === null) err(i, t, `Fecha inválida: ${v}`);
      else if (dateCount === 0) spec.start = v;
      else if (dateCount === 1) spec.end = v;
      else err(i, t, 'Una tarea admite como máximo dos fechas (inicio y fin)', 'warning');
      dateCount++;
    } else if (v === '->' || v === '..' || lower === 'to') {
      // separador de rango: "2026-11-02 -> 2026-11-10"
    } else if (lower === 'milestone') {
      spec.milestone = true;
    } else if (lower === 'after') {
      const refToks: Token[] = [];
      k++;
      while (k < toks.length && !isAttrToken(toks[k])) refToks.push(toks[k++]);
      const refs = joinValues(refToks).split(',').map((s) => s.trim()).filter(Boolean);
      if (!refs.length) err(i, t, '"after" necesita al menos una tarea: after Diseño, API');
      for (const r of refs) if (!spec.after.includes(r)) spec.after.push(r);
      continue;
    } else if (lower.startsWith('id:')) {
      const id = v.slice(3);
      if (!/^[\w-]+$/.test(id)) err(i, t, 'El id solo admite letras, números, "-" y "_"');
      else spec.id = id;
    } else {
      err(i, t, `No se reconoce "${v}". Si es parte del nombre, poné el nombre entre comillas.`, 'warning');
    }
    k++;
  }

  if (spec.start && spec.end && spec.end < spec.start) {
    err(i, null, 'La fecha de fin es anterior a la de inicio');
    spec.end = undefined;
  }
  if (spec.start && spec.end && spec.duration && !spec.milestone) {
    err(i, null, 'Con inicio y fin, la duración se ignora', 'warning');
  }
  return spec;
}
