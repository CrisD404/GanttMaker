import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const TOP_KEYWORDS = new Set([
  'gantt', 'title', 'start', 'today', 'calendar', 'holiday', 'holidays', 'sprints', 'sprint',
  'team', 'person', 'section', 'view',
]);
const SETTING_KEYWORDS = new Set(['scale', 'detail', 'columns', 'show', 'hide', 'density', 'filter', 'range', 'color']);
const HEADING_AFTER = new Set(['section', 'view', 'gantt', 'title']);
const STATUS = /^#(done|active|blocked|crit)\b/i;

interface State {
  first: boolean;
  /** El resto de la línea es un título (section, view, gantt). */
  heading: boolean;
  /** Estamos dentro de la lista de `after`. */
  after: boolean;
  /** Todavía estamos en el nombre de la tarea. */
  name: boolean;
  /** El resto de la línea son valores de un ajuste (start, calendar, scale…). */
  args: boolean;
  indent: number;
}

/** Resaltado del DSL de GanttMaker. */
export const ganttLanguage = StreamLanguage.define<State>({
  name: 'gantt',
  startState: () => ({ first: true, heading: false, after: false, name: false, args: false, indent: 0 }),
  token(stream, state) {
    if (stream.sol()) {
      state.first = true;
      state.heading = false;
      state.after = false;
      state.name = false;
      state.args = false;
      state.indent = stream.indentation();
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (state.args) {
      if (stream.match(/^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?/)) return 'number';
      if (stream.match(/^@"[^"]*"?|^@[^\s,]+/)) return 'variableName';
      if (stream.match(/^#[0-9a-f]{6}(?![\w-])|^#[0-9a-f]{3}(?![\w-])/i)) return 'atom';
      if (stream.match(/^#[^\s,]+/)) return 'tagName';
      if (stream.match(/^[,.]+|^->/)) return 'operator';
      if (stream.match(/^"[^"]*"?/)) return 'string';
      if (stream.match(/^\d+[dwDW]?(?!\S)/)) return 'number';
      if (stream.match(/^(from|first)(?!\S)/i)) return 'operatorKeyword';
      stream.match(/^[^\s,]+/);
      return 'propertyName';
    }
    if (state.heading) {
      if (stream.match(/^#[0-9a-f]{6}\b|^#[0-9a-f]{3}\b/i)) return 'atom';
      if (stream.match(/^@"[^"]*"?|^@\S+/)) return 'variableName';
      stream.match(/^"[^"]*"?|^[^\s]+/);
      return 'heading';
    }
    if (state.first) {
      state.first = false;
      const word = stream.match(/^[^\s"]+/, false) as RegExpMatchArray | null;
      const w = word?.[0].toLowerCase() ?? '';
      if ((TOP_KEYWORDS.has(w) && state.indent === 0) || SETTING_KEYWORDS.has(w)) {
        stream.match(/^[^\s]+/);
        if (HEADING_AFTER.has(w) || w === 'team' || w === 'person') state.heading = true;
        else state.args = true;
        return 'keyword';
      }
      state.name = true;
    }
    // Atributos
    if (stream.match(/^@"[^"]*"?|^@[^\s,]+/)) { state.name = false; state.after = false; return 'variableName'; }
    if (stream.match(/^#[0-9a-f]{6}(?![\w-])|^#[0-9a-f]{3}(?![\w-])/i)) { state.name = false; state.after = false; return 'atom'; }
    if (stream.match(STATUS)) { state.name = false; state.after = false; return 'string.special'; }
    if (stream.match(/^#[^\s,]+/)) { state.name = false; state.after = false; return 'tagName'; }
    if (stream.match(/^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?(?!\S)/)) { state.name = false; state.after = false; return 'number'; }
    if (stream.match(/^\d+[dwDW](?!\S)/) || stream.match(/^\d{1,3}%(?!\S)/)) { state.name = false; state.after = false; return 'number'; }
    if (stream.match(/^(after|milestone)(?!\S)/i)) {
      state.name = false;
      state.after = stream.current().toLowerCase() === 'after';
      return 'operatorKeyword';
    }
    if (stream.match(/^id:\S*/i)) { state.name = false; return 'meta'; }
    if (stream.match(/^(->|\.\.|to)(?!\S)/)) return 'operator';
    if (stream.match(/^"[^"]*"?/)) return state.after ? 'labelName' : 'strong';
    stream.match(/^[^\s]+/);
    if (state.after) return 'labelName';
    if (state.name) return 'strong';
    return 'invalid';
  },
  languageData: {
    commentTokens: { line: '//' },
  },
});

const style = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.operatorKeyword, color: 'var(--syn-keyword)' },
  { tag: t.heading, color: 'var(--syn-heading)', fontWeight: '600' },
  { tag: t.strong, color: 'var(--syn-name)' },
  { tag: t.variableName, color: 'var(--syn-owner)', fontWeight: '500' },
  { tag: t.tagName, color: 'var(--syn-tag)' },
  { tag: t.special(t.string), color: 'var(--syn-status)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--syn-color)' },
  { tag: t.propertyName, color: 'var(--syn-number)' },
  { tag: t.string, color: 'var(--syn-owner)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.labelName, color: 'var(--syn-ref)', fontStyle: 'italic' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--syn-comment)' },
  { tag: t.operator, color: 'var(--syn-comment)' },
  { tag: t.invalid, color: 'var(--syn-invalid)', textDecoration: 'underline wavy' },
]);

export const ganttHighlighting = syntaxHighlighting(style);
