import { useEffect, useRef } from 'preact/hooks';
import { basicSetup } from 'codemirror';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration, EditorView, MatchDecorator, ViewPlugin, WidgetType, keymap,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { compileCached } from '../core/index';
import { formatShort } from '../core/dates';
import type { GanttDoc } from '../core/types';
import { inspectorOpen, registerEditor, selectedKey, source, today } from '../state/store';
import { ganttCompletion } from './completion';
import { ganttHighlighting, ganttLanguage } from './language';

const docOf = (state: EditorState): GanttDoc => compileCached(state.doc.toString(), today);

// --- Errores en línea --------------------------------------------------------
const ganttLinter = linter(
  (view) => {
    const d = docOf(view.state);
    const out: CmDiagnostic[] = [];
    for (const x of d.diagnostics) {
      if (x.line >= view.state.doc.lines) continue;
      const line = view.state.doc.line(x.line + 1);
      const from = line.from + Math.min(x.from, line.length);
      const to = line.from + Math.min(Math.max(x.to, x.from + 1), line.length);
      out.push({ from, to: Math.max(to, from), severity: x.severity, message: x.message });
    }
    return out;
  },
  { delay: 200 },
);

// --- Fechas calculadas al final de cada tarea ("inlay hints") ---------------
class HintWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: HintWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-gantt-hint';
    s.textContent = this.text;
    return s;
  }
}

function buildHints(view: EditorView): DecorationSet {
  const d = docOf(view.state);
  const b = new RangeSetBuilder<Decoration>();
  for (const t of d.tasks) {
    if (t.line >= view.state.doc.lines) continue;
    const line = view.state.doc.line(t.line + 1);
    const text = t.spec.milestone ? `◆ ${formatShort(t.start)}` : `${formatShort(t.start)} → ${formatShort(t.end - 1)}`;
    b.add(line.to, line.to, Decoration.widget({ widget: new HintWidget(text), side: 1 }));
  }
  return b.finish();
}

const hintsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHints(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = buildHints(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// --- Muestras de color junto a #hex -----------------------------------------
class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(o: SwatchWidget) {
    return o.color === this.color;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-gantt-swatch';
    s.style.background = this.color;
    return s;
  }
}
const swatchMatcher = new MatchDecorator({
  regexp: /#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![\w-])/gi,
  decoration: (m) => Decoration.widget({ widget: new SwatchWidget(m[0]), side: -1 }),
});
const swatchPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = swatchMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = swatchMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

// --- Destello de línea al seleccionar desde el gráfico ----------------------
const flashEffect = StateEffect.define<number | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) {
        if (e.value === null) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(e.value + 1);
          deco = Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(line.from)]);
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** Mueve el cursor a la línea indicada y la resalta (sin robar el foco). */
export function revealLine(view: EditorView, line: number) {
  if (line < 0 || line >= view.state.doc.lines) return;
  const l = view.state.doc.line(line + 1);
  view.dispatch({
    selection: { anchor: l.from + (l.text.length - l.text.trimStart().length) },
    effects: [flashEffect.of(line), EditorView.scrollIntoView(l.from, { y: 'center' })],
    userEvent: 'select.reveal',
  });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1400);
}

// --- Tema (usa las variables CSS de la app) ---------------------------------
const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--editor-selection) !important' },
  '.cm-tooltip': { background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '18em' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '1em' },
  '.cm-diagnostic': { fontFamily: 'var(--font-sans)', padding: '6px 10px' },
  '.cm-foldGutter span': { color: 'var(--text-faint)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-soft)' },
  '.cm-panels': { background: 'var(--surface-raised)', color: 'var(--text)', borderColor: 'var(--border)' },
});

export function Editor() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let view: EditorView;
    const extensions = [
      basicSetup,
      keymap.of([indentWithTab]),
      ganttLanguage,
      ganttLanguage.data.of({ autocomplete: ganttCompletion(() => docOf(view.state)) }),
      ganttHighlighting,
      ganttLinter,
      hintsPlugin,
      swatchPlugin,
      flashField,
      editorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) source.value = u.state.doc.toString();
        // Cursor del usuario → seleccionar la tarea de esa línea en el gráfico
        const userMoved = u.transactions.some((tr) => tr.isUserEvent('select') && !tr.isUserEvent('select.reveal'));
        if (u.selectionSet && userMoved) {
          const line = u.state.doc.lineAt(u.state.selection.main.head).number - 1;
          const t = docOf(u.state).tasks.find((x) => x.line === line);
          if (t && t.key !== selectedKey.value) {
            selectedKey.value = t.key;
            inspectorOpen.value = false;
          }
        }
      }),
    ];
    view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: source.value, extensions }) });
    // Cambiar de espacio = estado nuevo (el historial de deshacer no se mezcla entre diagramas)
    registerEditor(view, (text) => view.setState(EditorState.create({ doc: text, extensions })));
    return () => {
      registerEditor(null);
      view.destroy();
    };
  }, []);

  return <div class="editor-host" ref={host} />;
}
