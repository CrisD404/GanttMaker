import { useEffect, useState } from 'preact/hooks';
import { downloadBlob } from '../io/export';
import { downloadBackup, pickFile } from '../io/files';
import { installDialogOpen, installHint, installPrompt, isOfflineFile, isStandalone, promptInstall } from '../state/install';
import { spaces, toast } from '../state/store';
import { Icon } from './icons';

const OFFLINE_FILE = 'ganttmaker.html';

export function InstallDialog() {
  const [closing, setClosing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(() => {
      installDialogOpen.value = false;
      setClosing(false);
    }, 160);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const install = async () => {
    if (await promptInstall()) close();
  };

  const downloadOffline = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`./${OFFLINE_FILE}`, { cache: 'no-cache' });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) throw new Error('no disponible');
      const html = await res.text();
      if (!html.includes('__GM_OFFLINE__')) throw new Error('no disponible');
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), OFFLINE_FILE);
      toast('Descargado: abrilo con doble clic, funciona sin internet', 'success');
    } catch {
      toast('El archivo offline se genera al publicar la app (npm run build)', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const canPrompt = !!installPrompt.value;

  return (
    <>
      <div class="drawer-overlay" onClick={close} style={closing ? { opacity: 0, transition: 'opacity 160ms' } : undefined} />
      <div class={`dialog ${closing ? 'closing' : ''}`} role="dialog" aria-label="Descargar GanttMaker">
        <div class="dialog-head">
          <div class="brand-logo"><Icon name="download" size={16} style={{ color: '#fff' }} /></div>
          <div>
            <h2>Descargar GanttMaker</h2>
            <p>Usala sin conexión, como una app más de tu equipo.</p>
          </div>
          <span class="spacer" />
          <button class="icon-btn" onClick={close} title="Cerrar (Esc)"><Icon name="x" /></button>
        </div>

        <div class="dialog-cards">
          <div class="dl-card">
            <div class="dl-icon"><Icon name="grid" size={20} /></div>
            <div class="dl-body">
              <h3>Instalar como aplicación</h3>
              <p>Se abre en su propia ventana, funciona sin internet, abre archivos <code>.gantt</code> y comparte tus espacios con esta web.</p>
              {isStandalone ? (
                <span class="dl-ok"><Icon name="check" size={14} /> Ya la estás usando instalada</span>
              ) : canPrompt ? (
                <button class="btn primary" onClick={install}><Icon name="download" size={14} /> Instalar</button>
              ) : (
                <p class="dl-hint">{isOfflineFile ? 'Abrí la versión web publicada para instalarla.' : installHint()}</p>
              )}
            </div>
          </div>

          <div class="dl-card">
            <div class="dl-icon"><Icon name="file" size={20} /></div>
            <div class="dl-body">
              <h3>Archivo HTML sin conexión</h3>
              <p>Toda la app en <b>un solo archivo</b>. Guardalo donde quieras y abrilo con doble clic, sin instalar nada ni conectarte.</p>
              <p class="dl-hint">Guarda los datos en el navegador donde lo abras. Para llevar tus diagramas, usá la copia de seguridad.</p>
              {isOfflineFile ? (
                <span class="dl-ok"><Icon name="check" size={14} /> Estás usando el archivo offline</span>
              ) : (
                <button class="btn" onClick={downloadOffline} disabled={downloading}>
                  <Icon name="download" size={14} /> {downloading ? 'Descargando…' : `Descargar ${OFFLINE_FILE}`}
                </button>
              )}
            </div>
          </div>

          <div class="dl-card">
            <div class="dl-icon"><Icon name="save" size={20} /></div>
            <div class="dl-body">
              <h3>Copia de seguridad de tus espacios</h3>
              <p>
                Exportá {spaces.value.length === 1 ? 'tu espacio' : `tus ${spaces.value.length} espacios`} en un archivo <code>.json</code> e
                importalos en otro navegador, en la app instalada o en el archivo offline.
              </p>
              <div class="dl-actions">
                <button class="btn" onClick={downloadBackup}><Icon name="download" size={14} /> Exportar espacios</button>
                <button class="btn ghost" onClick={() => pickFile('.json,application/json')}><Icon name="upload" size={14} /> Importar…</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
