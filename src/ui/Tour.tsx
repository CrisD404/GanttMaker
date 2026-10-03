// Tutorial de bienvenida: un "spotlight" que se desliza entre los controles más importantes.
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { dockOpen, editorOpen, presenting } from '../state/store';
import { Icon } from './icons';

const LS_TOUR = 'ganttmaker:tour-done';

export const tourActive = signal(false);
const tourStep = signal(0);

type Placement = 'bottom' | 'top' | 'left' | 'right' | 'inside' | 'center';

interface Step {
  /** Selector del elemento a destacar (null = centrado, sin destacar nada). */
  target: string | null;
  title: string;
  body: string;
  placement: Placement;
  /** Preparar la pantalla (abrir un panel, etc.) antes de medir. */
  before?: () => void;
  padding?: number;
}

const STEPS: Step[] = [
  {
    target: null,
    placement: 'center',
    title: '¡Bienvenido a GanttMaker!',
    body: 'Planificá escribiendo y ajustá con el mouse: el código y el gráfico siempre están sincronizados. Te muestro lo esencial en un minuto.',
  },
  {
    target: '.editor-panel',
    placement: 'right',
    before: () => (editorOpen.value = true),
    title: 'Tu plan es código',
    body: 'Una línea por tarea, por ejemplo «Diseño @Ana 5d after Brief». Tenés autocompletado con Ctrl+Espacio y los errores se marcan al instante.',
  },
  {
    target: '.scroller',
    placement: 'inside',
    padding: -6,
    title: 'Un gantt que se toca',
    body: 'Arrastrá las barras para moverlas, estirá sus bordes, uní tareas desde el punto ● y hacé doble clic en un espacio vacío para crear una tarea. Clic derecho: más opciones.',
  },
  {
    target: '.tabs',
    placement: 'bottom',
    title: 'Vistas para cada público',
    body: 'El mismo plan con otro nivel de detalle: ejecutivo, por equipo, de riesgos… Cada vista guarda su escala, columnas y filtros.',
  },
  {
    target: '.gantt-toolbar .ctrl-group',
    placement: 'bottom',
    title: 'Escala, detalle y zoom',
    body: 'Día, semana, sprint, mes… y cuántos niveles mostrar. Ctrl + rueda hace zoom y un doble clic en el encabezado ajusta a ese período.',
  },
  {
    target: '.filter-dock',
    placement: 'top',
    before: () => (dockOpen.value = true),
    title: 'Filtros rápidos',
    body: 'Buscá, filtrá por persona o estado y mirá el resultado al instante. No tocan el código hasta que los guardes en la vista.',
  },
  {
    target: '.spaces-btn',
    placement: 'bottom',
    title: 'Espacios y plantillas',
    body: 'Cada diagrama es un espacio guardado en este navegador. Empezá uno en blanco o desde una plantilla con casos de uso típicos.',
  },
  {
    target: '.appbar-actions',
    placement: 'bottom',
    title: 'Presentá, compartí y descargá',
    body: 'Presentá a pantalla completa con láser y foco, compartí un enlace que lleva el diagrama o instalá la app para usarla sin conexión.',
  },
  {
    target: '.help-btn',
    placement: 'bottom',
    padding: 6,
    title: 'Siempre a mano',
    body: 'Acá están la guía completa, los atajos de teclado y este tutorial, para repetirlo cuando quieras. ¡A planificar!',
  },
];

function markDone() {
  try { localStorage.setItem(LS_TOUR, new Date().toISOString()); } catch { /* sin almacenamiento */ }
}

export function startTour() {
  if (presenting.value) return;
  tourStep.value = 0;
  tourActive.value = true;
}

/** Primera visita: arrancar el tutorial (con un respiro para que la app termine de dibujarse). */
export function maybeStartTour() {
  let done: string | null = null;
  try { done = localStorage.getItem(LS_TOUR); } catch { done = 'unknown'; }
  if (!done) setTimeout(startTour, 900);
}

interface Rect { x: number; y: number; w: number; h: number }

function measure(step: Step): Rect | null {
  if (!step.target) return null;
  const el = document.querySelector(step.target) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const pad = step.padding ?? 8;
  return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
}

export function Tour() {
  const index = tourStep.value;
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState({ top: 0, left: 0 });
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const skipped = useRef(false);

  // Preparar la pantalla y seguir al elemento mientras se anima (paneles que se abren, etc.)
  useEffect(() => {
    step.before?.();
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      setRect(measure(step));
      if (performance.now() - t0 < 650) raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => setRect(measure(step));
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [index]);

  // Ubicar la tarjeta junto al destacado (dándola vuelta si no entra)
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c) return;
    const cw = c.offsetWidth, ch = c.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, m = 14, gap = 16;
    let top: number, left: number;
    if (!rect || step.placement === 'center') {
      top = (vh - ch) / 2;
      left = (vw - cw) / 2;
    } else {
      let p = step.placement;
      if (p === 'bottom' && rect.y + rect.h + gap + ch > vh - m) p = 'top';
      if (p === 'top' && rect.y - gap - ch < m) p = 'bottom';
      if (p === 'right' && rect.x + rect.w + gap + cw > vw - m) p = 'inside';
      if (p === 'left' && rect.x - gap - cw < m) p = 'inside';
      switch (p) {
        case 'bottom': top = rect.y + rect.h + gap; left = rect.x + rect.w / 2 - cw / 2; break;
        case 'top': top = rect.y - gap - ch; left = rect.x + rect.w / 2 - cw / 2; break;
        case 'right': top = rect.y + rect.h / 2 - ch / 2; left = rect.x + rect.w + gap; break;
        case 'left': top = rect.y + rect.h / 2 - ch / 2; left = rect.x - gap - cw; break;
        default: top = rect.y + rect.h / 2 - ch / 2; left = rect.x + rect.w / 2 - cw / 2;
      }
    }
    setCard({
      top: Math.max(m, Math.min(top, vh - ch - m)),
      left: Math.max(m, Math.min(left, vw - cw - m)),
    });
  }, [rect, index]);

  const finish = () => {
    markDone();
    setLeaving(true);
    setTimeout(() => {
      tourActive.value = false;
      setLeaving(false);
    }, 260);
  };
  const next = () => (last ? finish() : (tourStep.value = index + 1));
  const prev = () => index > 0 && (tourStep.value = index - 1);
  /** Omitir: ir directo (animado) a dónde se repite el tutorial. */
  const skip = () => {
    skipped.current = true;
    tourStep.value = STEPS.length - 1;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); last ? finish() : skip(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index]);

  const hole = rect ?? { x: window.innerWidth / 2, y: window.innerHeight / 2, w: 0, h: 0 };
  const finalText = last && skipped.current
    ? 'Cuando quieras ver el tutorial, lo encontrás acá, junto a la guía y los atajos de teclado.'
    : step.body;

  return (
    <div class={`tour ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-label="Tutorial">
      <div class="tour-block" onPointerDown={(e) => e.stopPropagation()} />
      <div
        class={`tour-hole ${rect ? '' : 'none'}`}
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
      />
      <div class="tour-card" ref={cardRef} style={{ top: card.top, left: card.left }}>
        <div class="tour-content" key={index}>
          <div class="tour-step">
            {index === 0 ? <Icon name="sparkle" size={14} /> : last ? <Icon name="compass" size={14} /> : null}
            {index > 0 && !last && `${index} de ${STEPS.length - 2}`}
            {index === 0 && 'Tutorial'}
            {last && 'Para la próxima'}
          </div>
          <h3>{step.title}</h3>
          <p>{finalText}</p>
        </div>
        <div class="tour-dots" aria-hidden="true">
          {STEPS.map((_, i) => <span key={i} class={i === index ? 'on' : i < index ? 'done' : ''} />)}
        </div>
        <div class="tour-actions">
          {!last && <button class="btn sm ghost" onClick={skip}>Omitir</button>}
          <span class="spacer" />
          {index > 0 && !last && <button class="btn sm" onClick={prev}><Icon name="chevronDown" size={13} style={{ transform: 'rotate(90deg)' }} /> Anterior</button>}
          <button class="btn sm primary" onClick={next}>
            {index === 0 ? 'Empezar' : last ? 'Entendido' : 'Siguiente'}
            {!last && <Icon name="chevronRight" size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
