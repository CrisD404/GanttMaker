import { createSpace, exportSpaces, importSpaces, toast } from '../state/store';
import { downloadText } from './export';
import { looksLikeMermaid, mermaidToGantt } from './mermaid';

/** Abre un archivo en un espacio nuevo (nunca pisa el diagrama actual). */
export async function openTextFile(file: File) {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    try {
      const n = importSpaces(text);
      toast(`${n} espacio${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'}`, 'success');
    } catch {
      toast('El archivo no es una copia de seguridad de GanttMaker', 'error');
    }
    return;
  }
  if (looksLikeMermaid(text) && !/^\s*gantt\s+"/m.test(text)) {
    createSpace(mermaidToGantt(text));
    toast(`Importado desde Mermaid en un espacio nuevo: ${file.name}`, 'success');
  } else {
    createSpace(text);
    toast(`Abierto en un espacio nuevo: ${file.name}`, 'success');
  }
}

/** Descarga todos los espacios como JSON (para llevarlos entre la web, la app instalada y el HTML offline). */
export function downloadBackup() {
  const date = new Date().toISOString().slice(0, 10);
  downloadText(exportSpaces(), `ganttmaker-espacios-${date}.json`, 'application/json');
}

/** Pide un archivo al usuario y lo abre (diagrama, Mermaid o copia de seguridad). */
export function pickFile(accept = '.gantt,.txt,.mmd,.md,.json,text/plain,application/json') {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) openTextFile(f);
  };
  input.click();
}
