import { setTitle } from '../core/writer';
import { AddMenu } from '../gantt/GanttToolbar';
import { downloadBlob, downloadText, exportSvg, fileSlug, svgToPng } from '../io/export';
import { downloadBackup, pickFile } from '../io/files';
import { installDialogOpen, installPrompt, isStandalone } from '../state/install';
import {
  collapsed, currentView, doc, edit, editorOpen, helpOpen, redo, saveState, settings, shareUrl, source,
  storagePersisted, theme, toast, today, undo, zoom,
} from '../state/store';
import { MenuItems, Popover } from './controls';
import { Icon } from './icons';
import { newSpaceFrom, SpacesMenu } from './SpacesMenu';
import { templatesDialogOpen } from './TemplatesDialog';
import { startPresentation } from '../present/Presentation';
import { openHelpAt } from './HelpDrawer';
import { startTour } from './Tour';

function exportOpts() {
  return {
    doc: doc.value,
    settings: settings.value,
    collapsed: collapsed.value,
    zoom: zoom.value,
    today,
    theme: theme.value,
    viewName: currentView.value,
  };
}

export async function copyShareLink() {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado: contiene todo el diagrama, sin servidor', 'success');
  } catch {
    prompt('Copiá este enlace:', url);
  }
}

/** "Guardado": confirma que el diagrama vive en este navegador y si el almacenamiento es persistente. */
function SaveIndicator() {
  const st = saveState.value;
  const persisted = storagePersisted.value;
  const title =
    st === 'error'
      ? 'No se pudo guardar en el navegador. Clic para descargar una copia de seguridad.'
      : `Guardado automáticamente en este navegador.\nTus espacios siguen acá cada vez que vuelvas con el mismo navegador (mientras no borres sus datos).\n` +
        (persisted ? 'Almacenamiento persistente: activado (el navegador no lo borra para liberar espacio).' : 'Para llevarlos a otro equipo: Archivo → Copia de seguridad.');
  return (
    <button
      class={`save-ind ${st}`}
      title={title}
      onClick={() => (st === 'error' ? downloadBackup() : toast(persisted ? 'Guardado en este navegador, con almacenamiento persistente ✓' : 'Guardado en este navegador ✓', 'success'))}
    >
      {st === 'saving' ? <span class="save-dot" /> : <Icon name={st === 'error' ? 'alert' : persisted ? 'shield' : 'check'} size={13} />}
      <span class="hide-sm">{st === 'saving' ? 'Guardando…' : st === 'error' ? 'Sin guardar' : 'Guardado'}</span>
    </button>
  );
}

export function AppBar() {
  const d = doc.value;
  const name = fileSlug(d.title);

  const exportSvgFile = () => {
    const { svg } = exportSvg(exportOpts());
    downloadText(svg, `${name}.svg`, 'image/svg+xml');
  };
  const exportPng = async () => {
    try {
      const { svg, width, height } = exportSvg(exportOpts());
      downloadBlob(await svgToPng(svg, width, height), `${name}.png`);
    } catch (e) {
      console.error(e);
      toast('No se pudo exportar a PNG', 'error');
    }
  };

  return (
    <header class="appbar">
      <div class="brand">
        <div class="brand-logo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff">
            <rect x="1" y="2" width="9" height="3" rx="1.5" />
            <rect x="4" y="6.5" width="10" height="3" rx="1.5" opacity=".85" />
            <rect x="2.5" y="11" width="7" height="3" rx="1.5" opacity=".7" />
          </svg>
        </div>
        <span class="hide-sm">GanttMaker</span>
      </div>
      <div class="divider-v" />
      <SpacesMenu />
      <input
        class="doc-title"
        value={d.title}
        placeholder="Sin título"
        key={d.title}
        title="Título del diagrama (línea gantt)"
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v !== d.title) edit((text, doc) => setTitle(text, doc, v));
        }}
      />
      <SaveIndicator />
      <AddMenu />
      <span class="spacer" />

      <button class={`icon-btn ${editorOpen.value ? 'active' : ''}`} title="Mostrar/ocultar código (E)" onClick={() => (editorOpen.value = !editorOpen.value)}>
        <Icon name="code" />
      </button>
      <div class="divider-v" />
      <button class="icon-btn" title="Deshacer (Ctrl+Z)" onClick={undo}>
        <Icon name="undo" />
      </button>
      <button class="icon-btn" title="Rehacer (Ctrl+Shift+Z)" onClick={redo}>
        <Icon name="redo" />
      </button>
      <div class="divider-v" />

      <Popover
        trigger={(_, toggle) => (
          <button class="btn sm ghost" onClick={toggle}>
            <Icon name="file" size={14} /> Archivo
          </button>
        )}
      >
        {(close) => (
          <MenuItems
            close={close}
            items={[
              { label: 'Nuevo espacio vacío', icon: <Icon name="filePlus" size={14} />, onClick: () => newSpaceFrom('blank') },
              { label: 'Nuevo desde plantilla…', icon: <Icon name="template" size={14} />, onClick: () => (templatesDialogOpen.value = true) },
              { label: 'Abrir archivo…', icon: <Icon name="upload" size={14} />, hint: '.gantt .mmd .json', onClick: () => pickFile() },
              { separator: true },
              { label: 'Descargar código', icon: <Icon name="download" size={14} />, hint: '.gantt', onClick: () => downloadText(source.value, `${name}.gantt`) },
              { label: 'Exportar SVG', icon: <Icon name="image" size={14} />, hint: 'vectorial', onClick: exportSvgFile },
              { label: 'Exportar PNG', icon: <Icon name="image" size={14} />, hint: '2×', onClick: exportPng },
              { label: 'Copiar código', icon: <Icon name="copy" size={14} />, onClick: () => navigator.clipboard.writeText(source.value).then(() => toast('Código copiado', 'success')) },
              { separator: true },
              { label: 'Copia de seguridad de espacios', icon: <Icon name="save" size={14} />, hint: '.json', onClick: downloadBackup },
              { label: 'Descargar o instalar la app…', icon: <Icon name="grid" size={14} />, onClick: () => (installDialogOpen.value = true) },
            ]}
          />
        )}
      </Popover>
      <div class="appbar-actions">
        <button class="btn sm ghost" onClick={startPresentation} title="Presentar a pantalla completa, con láser y foco (P)">
          <Icon name="play" size={14} /> <span class="hide-sm">Presentar</span>
        </button>
        {!isStandalone && (
          <button
            class={`btn sm ghost ${installPrompt.value ? 'install-ready' : ''}`}
            onClick={() => (installDialogOpen.value = true)}
            title="Descargar GanttMaker: instalarla como app o bajar el archivo offline"
          >
            <Icon name="download" size={14} /> <span class="hide-sm">App</span>
          </button>
        )}
        <button class="btn sm primary" onClick={copyShareLink} title="Copiar un enlace con el diagrama">
          <Icon name="link" size={14} /> <span class="hide-sm">Compartir</span>
        </button>
      </div>
      <button class="icon-btn" title="Cambiar tema" onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}>
        <Icon name={theme.value === 'dark' ? 'sun' : 'moon'} />
      </button>
      <Popover
        trigger={(open, toggle) => (
          <button class={`icon-btn help-btn ${open ? 'active' : ''}`} title="Ayuda, atajos y tutorial" onClick={toggle}>
            <Icon name="help" />
          </button>
        )}
      >
        {(close) => (
          <MenuItems
            close={close}
            items={[
              { label: 'Guía y sintaxis', icon: <Icon name="book" size={14} />, hint: '?', onClick: () => (helpOpen.value = true) },
              { label: 'Atajos de teclado', icon: <Icon name="keyboard" size={14} />, onClick: () => openHelpAt('atajos-de-teclado') },
              { label: 'Repetir tutorial', icon: <Icon name="compass" size={14} />, onClick: startTour },
            ]}
          />
        )}
      </Popover>
    </header>
  );
}
