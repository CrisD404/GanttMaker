// Modo presentación: el gantt a pantalla completa, de solo lectura, con un dock flotante para
// puntero láser, foco (spotlight), destacar tareas, zoom y cambio de vista.
import { useEffect, useRef, useState } from 'preact/hooks';
import { selectTask } from '../state/actions';
import {
  activeView, currentView, doc, fitProject, inspectorOpen, presenting, presentTool, selectedKey, setZoom,
  theme, zoom, type PresentTool,
} from '../state/store';
import { Icon } from '../ui/icons';
import { Select } from '../ui/inputs';

let restore: { zoom: number } | null = null;
let enteredFullscreen = false;

export async function startPresentation() {
  if (presenting.value) return;
  restore = { zoom: zoom.value };
  inspectorOpen.value = false;
  selectTask(null, { reveal: false });
  presentTool.value = 'pointer';
  presenting.value = true;
  enteredFullscreen = false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      enteredFullscreen = true;
    }
  } catch {
    /* sin permiso de pantalla completa (p. ej. dentro de un iframe): se presenta igual en la ventana */
  }
  // Esperar a que se plieguen los paneles y encuadrar todo el proyecto
  setTimeout(fitProject, 480);
}

export function stopPresentation() {
  if (!presenting.value) return;
  presenting.value = false;
  presentTool.value = 'pointer';
  selectedKey.value = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (restore) setZoom(restore.zoom);
  restore = null;
}

if (typeof document !== 'undefined') {
  // Si el usuario sale de pantalla completa (Esc del navegador), termina la presentación
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && presenting.value && enteredFullscreen) stopPresentation();
  });
}

/** Teclas que siguen funcionando normalmente (Espacio = arrastrar para moverse, [ ] = tamaño del foco). */
const PASS_KEYS = new Set(['F11', 'F12', 'Tab', ' ', 'Shift', 'Alt', 'Control', 'Meta', '[', ']']);

const TOOLS: { id: PresentTool; icon: string; label: string; key: string }[] = [
  { id: 'pointer', icon: 'hand', label: 'Mover y destacar', key: 'V' },
  { id: 'laser', icon: 'laser', label: 'Puntero láser', key: 'L' },
  { id: 'spotlight', icon: 'target', label: 'Foco', key: 'F' },
];

/** Capa de presentación: título, dock, láser y foco. */
export function PresentationLayer() {
  const [idle, setIdle] = useState(false);
  const [hint, setHint] = useState(true);
  const hoverDock = useRef(false);
  const tool = presentTool.value;

  // Ocultar el dock y el título cuando el mouse queda quieto
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => !hoverDock.current && setIdle(true), 2600);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    const h = setTimeout(() => setHint(false), 5000);
    return () => {
      clearTimeout(t);
      clearTimeout(h);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Atajos propios de la presentación (bloquean los de edición)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, [data-floating]')) return;
      const k = e.key.toLowerCase();
      let handled = true;
      if (e.key === 'Escape') {
        if (selectedKey.value) selectedKey.value = null;
        else stopPresentation();
      } else if (k === 'v') presentTool.value = 'pointer';
      else if (k === 'l') presentTool.value = presentTool.value === 'laser' ? 'pointer' : 'laser';
      else if (k === 'f') presentTool.value = presentTool.value === 'spotlight' ? 'pointer' : 'spotlight';
      else if (e.key === '+' || e.key === '=') setZoom(zoom.value * 1.25);
      else if (e.key === '-') setZoom(zoom.value / 1.25);
      else if (e.key === '0' || (e.shiftKey && e.code === 'Digit1')) fitProject();
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') cycleView(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') cycleView(-1);
      else if (k === 't') theme.value = theme.value === 'dark' ? 'light' : 'dark';
      // El resto de las teclas se bloquea (no se edita el diagrama mientras se presenta), salvo estas:
      else handled = e.ctrlKey || e.metaKey ? false : !PASS_KEYS.has(e.key);
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const views = [{ value: '', label: 'Principal' }, ...doc.value.views.map((v) => ({ value: v.name, label: v.name }))];

  return (
    <>
      {tool === 'laser' && <Laser />}
      {tool === 'spotlight' && <Spotlight />}
      <div class={`present-title ${idle ? 'idle' : ''}`}>
        <div class="brand-logo">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="#fff">
            <rect x="1" y="2" width="9" height="3" rx="1.5" />
            <rect x="4" y="6.5" width="10" height="3" rx="1.5" opacity=".85" />
            <rect x="2.5" y="11" width="7" height="3" rx="1.5" opacity=".7" />
          </svg>
        </div>
        <b>{doc.value.title || 'Sin título'}</b>
        {currentView.value && <span>· {currentView.value}</span>}
      </div>
      {hint && <div class="present-hint">Clic en una tarea para destacarla · L láser · F foco · ←→ vistas · Esc salir</div>}
      <div
        class={`present-dock ${idle ? 'idle' : ''}`}
        onPointerEnter={() => (hoverDock.current = true)}
        onPointerLeave={() => (hoverDock.current = false)}
        role="toolbar"
        aria-label="Herramientas de presentación"
      >
        {TOOLS.map((t) => (
          <button
            key={t.id}
            class={`pd-btn ${tool === t.id ? 'on' : ''}`}
            title={`${t.label} (${t.key})`}
            onClick={() => (presentTool.value = t.id)}
          >
            <Icon name={t.icon} size={17} />
          </button>
        ))}
        <span class="pd-sep" />
        <button class="pd-btn" title="Alejar (−)" onClick={() => setZoom(zoom.value / 1.25)}><Icon name="zoomOut" size={17} /></button>
        <span class="pd-zoom">{Math.round(zoom.value * 100)}%</span>
        <button class="pd-btn" title="Acercar (+)" onClick={() => setZoom(zoom.value * 1.25)}><Icon name="zoomIn" size={17} /></button>
        <button class="pd-btn" title="Ajustar al proyecto (0)" onClick={fitProject}><Icon name="focus" size={17} /></button>
        <span class="pd-sep" />
        <div class="pd-view" title="Vista (← →)">
          <Select
            value={currentView.value ?? ''}
            options={views}
            searchable={false}
            onChange={(v) => {
              activeView.value = v || null;
              setTimeout(fitProject, 60);
            }}
          />
        </div>
        <button class="pd-btn" title="Tema claro/oscuro (T)" onClick={() => (theme.value = theme.value === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme.value === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <span class="pd-sep" />
        <button class="pd-btn exit" title="Salir de la presentación (Esc)" onClick={stopPresentation}>
          <Icon name="exit" size={17} />
          <span>Salir</span>
        </button>
      </div>
    </>
  );
}

function cycleView(step: number) {
  const names = [null, ...doc.value.views.map((v) => v.name)];
  const i = names.indexOf(currentView.value);
  activeView.value = names[(i + step + names.length) % names.length];
  setTimeout(fitProject, 60);
}

// ---------------------------------------------------------------------------
// Puntero láser: un punto rojo con estela que se desvanece
// ---------------------------------------------------------------------------

function Laser() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      cv.width = innerWidth * dpr;
      cv.height = innerHeight * dpr;
    };
    resize();
    const pts: { x: number; y: number; t: number }[] = [];
    const TRAIL = 380;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const draw = () => {
      raf = 0;
      const now = performance.now();
      while (pts.length && now - pts[0].t > TRAIL) pts.shift();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const k = 1 - (now - pts[i].t) / TRAIL;
        ctx.strokeStyle = `rgba(255, 45, 70, ${0.85 * k})`;
        ctx.shadowColor = 'rgba(255, 30, 60, 0.9)';
        ctx.shadowBlur = 12 * k;
        ctx.lineWidth = 2 + 6 * k;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      const head = pts[pts.length - 1];
      if (head) {
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#ff2d46';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd6dc';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pts.length > 1) raf = requestAnimationFrame(draw);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={canvas} class="laser-canvas" />;
}

// ---------------------------------------------------------------------------
// Foco: oscurece todo salvo un círculo que sigue al puntero (Alt + rueda o [ ] cambian el tamaño)
// ---------------------------------------------------------------------------

function Spotlight() {
  const el = useRef<HTMLDivElement>(null);
  const [r, setR] = useState(170);
  useEffect(() => {
    const div = el.current!;
    const onMove = (e: PointerEvent) => {
      div.style.setProperty('--x', `${e.clientX}px`);
      div.style.setProperty('--y', `${e.clientY}px`);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      setR((v) => Math.max(60, Math.min(520, v * Math.exp(-e.deltaY * 0.0015))));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '[') setR((v) => Math.max(60, v / 1.2));
      if (e.key === ']') setR((v) => Math.min(520, v * 1.2));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return <div ref={el} class="spotlight" style={{ '--r': `${r}px`, '--x': '50vw', '--y': '50vh' } as Record<string, string>} />;
}
