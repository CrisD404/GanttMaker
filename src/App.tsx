import { useEffect, useRef, useState } from 'preact/hooks';
import { SCALES } from './core/types';
import { Editor } from './editor/Editor';
import { FOCUS_SEARCH_EVENT } from './gantt/FilterDock';
import { GanttPanel } from './gantt/GanttPanel';
import { GanttToolbar } from './gantt/GanttToolbar';
import {
  addTaskAfter, deleteTask, duplicateTask, nudgeTask, selectTask, setScale, startRename,
} from './state/actions';
import {
  contextMenu, doc, dockOpen, editorOpen, fitProject, getEditor, helpOpen, inspectorOpen, openedFromLink, presenting,
  presentTool, redo, scrollToDay, selectedKey, selectedTask, setZoom, today, toast, undo, zoom,
} from './state/store';
import { openTextFile } from './io/files';
import { installDialogOpen } from './state/install';
import { AppBar } from './ui/AppBar';
import { ContextMenuHost } from './ui/controls';
import { HelpDrawer } from './ui/HelpDrawer';
import { InstallDialog } from './ui/InstallDialog';
import { TemplatesDialog, templatesDialogOpen } from './ui/TemplatesDialog';
import { PresentationLayer, startPresentation } from './present/Presentation';
import { Tour, tourActive, maybeStartTour } from './ui/Tour';
import { Toasts } from './ui/Toasts';

const LS_WIDTH = 'ganttmaker:editorWidth';

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest('input, textarea, select, [contenteditable], .cm-editor');
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod && key.toLowerCase() === 's') {
        e.preventDefault();
        toast('Se guarda automáticamente en este navegador ✓', 'success');
        return;
      }
      if (isTyping(e)) return;

      // Deshacer / rehacer fuera del editor
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      const sel = selectedKey.value;
      const t = selectedTask.value;
      if (sel && t) {
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          deleteTask(sel);
          return;
        }
        if (key === 'Enter' && (e.altKey || mod)) {
          e.preventDefault();
          addTaskAfter(sel);
          return;
        }
        if (key === 'Enter') {
          e.preventDefault();
          inspectorOpen.value = true;
          return;
        }
        if (key === 'F2') {
          e.preventDefault();
          startRename(sel, 'grid');
          return;
        }
        if (mod && key.toLowerCase() === 'd') {
          e.preventDefault();
          duplicateTask(sel);
          return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          e.preventDefault();
          nudgeTask(sel, (key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1));
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          e.preventDefault();
          const tasks = doc.value.tasks;
          const i = tasks.indexOf(t);
          const next = tasks[i + (key === 'ArrowUp' ? -1 : 1)];
          if (next) selectTask(next.key);
          return;
        }
      }
      if (key === 'Escape') {
        if (contextMenu.value) contextMenu.value = null;
        else if (inspectorOpen.value) inspectorOpen.value = false;
        else selectTask(null);
        return;
      }
      if (mod || e.altKey) return;
      // Shift+1 = ajustar al proyecto (como en Figma/Excalidraw); se mira `code` porque `key` depende del teclado
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault();
        fitProject();
        return;
      }
      if (key === 'p' || key === 'P') startPresentation();
      else if (key === '?') helpOpen.value = true;
      else if (key === '/') {
        e.preventDefault();
        window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
      } else if (key === 'f' || key === 'F') dockOpen.value = !dockOpen.value;
      else if (key === 'e' || key === 'E') editorOpen.value = !editorOpen.value;
      else if (key === 't' || key === 'T') scrollToDay(today);
      else if (key === '+' || key === '=') setZoom(zoom.value * 1.25);
      else if (key === '-') setZoom(zoom.value / 1.25);
      else if (key === '0') setZoom(1);
      else if (/^[1-6]$/.test(key) && !e.shiftKey) setScale(SCALES[+key - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useFileDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const f = e.dataTransfer?.files[0];
      if (f) openTextFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

function EditorPanel() {
  const [width, setWidth] = useState(() => {
    const w = Number((() => { try { return localStorage.getItem(LS_WIDTH); } catch { return null; } })());
    return w > 200 ? w : 440;
  });
  const [resizing, setResizing] = useState(false);
  const open = editorOpen.value && !presenting.value;
  const d = doc.value;
  const errors = d.diagnostics.filter((x) => x.severity === 'error').length;
  const warnings = d.diagnostics.length - errors;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (open) setTimeout(() => getEditor()?.requestMeasure(), 450);
  }, [open]);

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const x0 = e.clientX;
    const w0 = widthRef.current;
    const move = (ev: PointerEvent) => setWidth(Math.min(Math.max(280, w0 + ev.clientX - x0), window.innerWidth - 360));
    const up = () => {
      setResizing(false);
      try { localStorage.setItem(LS_WIDTH, String(widthRef.current)); } catch { /* sin almacenamiento */ }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const gotoFirstError = () => {
    const first = d.diagnostics[0];
    const ed = getEditor();
    if (!first || !ed) return;
    const line = ed.state.doc.line(first.line + 1);
    ed.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    ed.focus();
  };

  return (
    <>
      <section class={`editor-panel ${open ? '' : 'closed'} ${resizing ? 'resizing' : ''}`} style={{ width: open ? width : 0 }} aria-hidden={!open}>
        <div class="editor-head">
          <span>CÓDIGO</span>
          {d.diagnostics.length === 0 ? (
            <span class="status-pill ok"><span class="dot" /> Sin errores</span>
          ) : (
            <span class={`status-pill ${errors ? 'err' : ''}`} onClick={gotoFirstError} title="Ir al primer problema">
              <span class="dot" />
              {errors ? `${errors} error${errors > 1 ? 'es' : ''}` : ''}
              {errors && warnings ? ' · ' : ''}
              {warnings ? `${warnings} aviso${warnings > 1 ? 's' : ''}` : ''}
            </span>
          )}
          <span class="spacer" />
          <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 11 }}>Ctrl+Espacio: sugerencias</span>
        </div>
        <Editor />
      </section>
      {open && <div class={`splitter ${resizing ? 'active' : ''}`} onPointerDown={startResize} />}
    </>
  );
}

export function App() {
  useShortcuts();
  const dropping = useFileDrop();

  useEffect(() => {
    if (openedFromLink) toast('Abriste un diagrama compartido en un espacio nuevo: tus otros espacios siguen intactos', 'info');
    else maybeStartTour();
    // Sin menú del navegador donde no hay uno propio (salvo para copiar/pegar texto)
    const onContext = (e: MouseEvent) => {
      if ((e.target as Element).closest?.('.cm-editor, input, textarea, [contenteditable], .doc')) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContext);
    return () => window.removeEventListener('contextmenu', onContext);
  }, []);

  const presentingNow = presenting.value;
  return (
    <div class={`app ${presentingNow ? `presenting tool-${presentTool.value}` : ''}`}>
      <AppBar />
      <div class="main">
        <EditorPanel />
        <main class="gantt-panel">
          <GanttToolbar />
          <GanttPanel />
        </main>
      </div>
      {presentingNow && <PresentationLayer />}
      {helpOpen.value && <HelpDrawer />}
      {installDialogOpen.value && <InstallDialog />}
      {templatesDialogOpen.value && <TemplatesDialog />}
      {tourActive.value && <Tour />}
      <ContextMenuHost />
      <Toasts />
      {dropping && <div class="dropzone">Soltá un archivo .gantt o Mermaid para abrirlo</div>}
    </div>
  );
}
