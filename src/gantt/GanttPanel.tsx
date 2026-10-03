import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { countWorkdays, formatMedium } from '../core/dates';
import { BASE_PX_PER_DAY, computeLayout } from '../render/layout';
import {
  collapsed, currentSpaceId, doc, dockOpen, fitProject, fitRequest, inspectorOpen, presenting, quickFilter, replaceAll,
  scrollRequest, scrollToDay, selectedTask, setZoom, settings, today, zoom, zooming,
} from '../state/store';
import { NOT_PANNABLE, panInfo } from './pan';
import { EMPTY } from '../samples';
import { templatesDialogOpen } from '../ui/TemplatesDialog';
import { initials } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Chart, type HoverInfo } from './Chart';
import { FilterDock } from './FilterDock';
import { Grid } from './Grid';
import { Inspector } from './Inspector';
import { openColumnsMenu } from './menus';
import { scrollX, Timeline } from './Timeline';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function GanttPanel() {
  const d = doc.value;
  const s = settings.value;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 1000, h: 600 });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [renamingSection, setRenamingSection] = useState<string | null>(null);

  // --- Zoom animado: interpolamos píxeles por día y mantenemos fijo el punto focal ---
  const targetPx = BASE_PX_PER_DAY[s.scale] * zoom.value;
  const [px, setPx] = useState(targetPx);
  const pxRef = useRef(px);
  pxRef.current = px;
  const focal = useRef<{ day: number; offset: number } | null>(null);
  const focusClientX = useRef<number | null>(null);
  /** Día que debe quedar al borde izquierdo al terminar la animación ("ajustar al período"). */
  const pendingAlign = useRef<number | null>(null);
  const layoutRef = useRef<ReturnType<typeof computeLayout> | null>(null);

  const alignToDay = (day: number, smooth: boolean) => {
    const sc = scrollerRef.current;
    const L = layoutRef.current;
    if (!sc || !L) return;
    sc.scrollTo({ left: Math.max(0, (day - L.rangeStart) * L.pxPerDay - 24), behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    const from = pxRef.current;
    const to = targetPx;
    if (Math.abs(from - to) < 1e-6) {
      if (pendingAlign.current !== null) {
        alignToDay(pendingAlign.current, true);
        pendingAlign.current = null;
      }
      return;
    }
    const sc = scrollerRef.current;
    const L0 = layoutRef.current;
    if (sc && L0) {
      const offset = focusClientX.current !== null
        ? focusClientX.current - sc.getBoundingClientRect().left - L0.gridW
        : (sc.clientWidth - L0.gridW) / 2;
      const day = pendingAlign.current ?? (sc.scrollLeft + offset) / from + L0.rangeStart;
      focal.current = { day, offset: pendingAlign.current !== null ? 24 : offset };
    }
    focusClientX.current = null;
    zooming.value = true;
    const t0 = performance.now();
    const dur = 420;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setPx(k < 1 ? from + (to - from) * easeOutCubic(k) : to);
      if (k < 1) raf = requestAnimationFrame(step);
      else zooming.value = false;
      // El punto focal se libera en el layout effect, cuando ya se dibujó el zoom final
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      zooming.value = false;
    };
  }, [targetPx]);

  // --- Tamaño del viewport ---
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Presentando: encuadrar todo el proyecto cada vez que cambia el ancho disponible
  // (al plegarse el editor, al entrar en pantalla completa o al redimensionar la ventana)
  useEffect(() => {
    if (!presenting.value) return;
    const t = setTimeout(fitProject, 140);
    return () => clearTimeout(t);
  }, [viewport.w, presenting.value]);

  const L = useMemo(
    () =>
      computeLayout({
        doc: d,
        settings: s,
        collapsed: collapsed.value,
        zoom: zoom.value,
        today,
        minChartWidth: Math.max(200, viewport.w - 10),
        pxPerDay: px,
        quick: quickFilter.value,
      }),
    [d, s, collapsed.value, px, viewport.w, quickFilter.value],
  );
  layoutRef.current = L;

  // Mantener el punto focal durante la animación de zoom (y soltarlo al llegar al zoom final)
  const targetPxRef = useRef(targetPx);
  targetPxRef.current = targetPx;
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || !focal.current) return;
    sc.scrollLeft = (focal.current.day - L.rangeStart) * L.pxPerDay - focal.current.offset;
    if (Math.abs(L.pxPerDay - targetPxRef.current) < 1e-6) {
      focal.current = null;
      pendingAlign.current = null;
    }
  }, [L]);

  // Desplazamiento inicial (y al cambiar de espacio): comienzo del proyecto
  const lastSpace = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastSpace.current === currentSpaceId.value || !d.tasks.length) return;
    lastSpace.current = currentSpaceId.value;
    const start = Math.min(...d.tasks.map((t) => t.start));
    const sc = scrollerRef.current;
    // Mantener el inicio del proyecto a la vista aunque haya un zoom animándose
    focal.current = { day: start, offset: 48 };
    if (sc) sc.scrollLeft = Math.max(0, (start - L.rangeStart) * L.pxPerDay - 48);
    if (Math.abs(L.pxPerDay - targetPxRef.current) < 1e-6) focal.current = null;
  }, [L, currentSpaceId.value]);

  // Pedidos externos de scroll
  useEffect(() => {
    const req = scrollRequest.value;
    const sc = scrollerRef.current;
    if (!req || !sc) return;
    const offset = req.align === 'start' ? 24 : (sc.clientWidth - L.gridW) / 3;
    sc.scrollTo({ left: Math.max(0, (req.day - L.rangeStart) * L.pxPerDay - offset), behavior: 'smooth' });
  }, [scrollRequest.value]);

  // "Ajustar al período": zoom animado para que [start, end) llene el ancho visible
  useEffect(() => {
    const req = fitRequest.value;
    const sc = scrollerRef.current;
    if (!req || !sc) return;
    const avail = Math.max(120, sc.clientWidth - L.gridW - 72);
    const days = Math.max(1, req.end - req.start);
    pendingAlign.current = req.start;
    setZoom(avail / days / BASE_PX_PER_DAY[s.scale]);
    // Si el zoom no cambia, el efecto de animación no corre: alinear ahora
    queueMicrotask(() => {
      if (pendingAlign.current !== null && Math.abs(BASE_PX_PER_DAY[s.scale] * zoom.value - pxRef.current) < 1e-6) {
        alignToDay(req.start, true);
        pendingAlign.current = null;
      }
    });
  }, [fitRequest.value]);

  // Ctrl + rueda = zoom alrededor del puntero
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      focusClientX.current = e.clientX;
      setZoom(zoom.value * Math.exp(-e.deltaY * 0.0025));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // --- Arrastrar para desplazar (pan) -----------------------------------------
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const spaceRef = useRef(false);
  const inertia = useRef(0);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable], .cm-editor');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e) || e.repeat) {
        if (e.code === 'Space' && spaceRef.current) e.preventDefault();
        return;
      }
      e.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const blur = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const startPan = (e: PointerEvent, opts: { immediate: boolean; lockY: boolean }) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    cancelAnimationFrame(inertia.current);
    const x0 = e.clientX, y0 = e.clientY, sl = sc.scrollLeft, st = sc.scrollTop;
    let moved = opts.immediate;
    let lastX = x0, lastY = y0, lastT = performance.now(), vx = 0, vy = 0;
    if (moved) setPanning(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0, dy = opts.lockY ? 0 : ev.clientY - y0;
      if (!moved) {
        if (Math.hypot(dx, dy) < 4) return;
        moved = true;
        setPanning(true);
        setHover(null);
      }
      sc.scrollLeft = sl - dx;
      sc.scrollTop = st - dy;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vx = 0.8 * ((lastX - ev.clientX) / dt) + 0.2 * vx;
      vy = opts.lockY ? 0 : 0.8 * ((lastY - ev.clientY) / dt) + 0.2 * vy;
      lastX = ev.clientX; lastY = ev.clientY; lastT = now;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setPanning(false);
      if (!moved) return;
      panInfo.lastPanEnd = performance.now();
      // Inercia: sigue deslizando y frena suavemente (velocidad acotada para que no "salga disparado")
      if (performance.now() - lastT > 80) return;
      const MAX_V = 1.8; // px/ms
      vx = Math.max(-MAX_V, Math.min(MAX_V, vx));
      vy = Math.max(-MAX_V, Math.min(MAX_V, vy));
      let t = performance.now();
      const glide = (now: number) => {
        const dt = Math.min(48, now - t);
        t = now;
        const k = Math.pow(0.91, dt / 16);
        vx *= k;
        vy *= k;
        sc.scrollLeft += vx * dt;
        sc.scrollTop += vy * dt;
        if (Math.abs(vx) + Math.abs(vy) > 0.02) inertia.current = requestAnimationFrame(glide);
      };
      inertia.current = requestAnimationFrame(glide);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const empty = d.tasks.length === 0;
  // Margen al final: las últimas filas pueden subir por encima del dock de filtros
  const bottomPad = dockOpen.value ? 96 : 64;
  const bodyH = Math.max(L.height + bottomPad, viewport.h - L.headerH);

  return (
    <>
      <div
        class={`scroller ${spaceHeld ? 'space-pan' : ''} ${panning ? 'panning' : ''}`}
        ref={scrollerRef}
        onScroll={(e) => {
          if (hover) setHover(null);
          scrollX.value = (e.currentTarget as HTMLDivElement).scrollLeft;
        }}
        onPointerDownCapture={(e) => {
          if (e.pointerType === 'touch') return;
          // Botón del medio o Espacio + arrastre: desplazar desde cualquier lugar
          if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
            e.preventDefault();
            e.stopPropagation();
            startPan(e, { immediate: true, lockY: false });
          } else {
            cancelAnimationFrame(inertia.current);
          }
        }}
        onPointerDown={(e) => {
          // Botón izquierdo sobre zonas sin otra función (fondo del gráfico, encabezado, grilla vacía)
          if (e.pointerType === 'touch' || e.button !== 0) return;
          const target = e.target as Element;
          if (target.closest(NOT_PANNABLE)) return;
          startPan(e, { immediate: false, lockY: !!target.closest('.timeline') });
        }}
        onAuxClick={(e) => e.button === 1 && e.preventDefault()}
        onWheel={() => cancelAnimationFrame(inertia.current)}
      >
        <div class={`canvas ${zooming.value ? 'no-anim' : ''}`}>
          <div class="head-row">
            <div
              class="corner"
              style={{ width: L.gridW, height: L.headerH }}
              onContextMenu={(e) => openColumnsMenu(e)}
              title="Clic derecho: elegir columnas"
            >
              {L.columns.map((c) => (
                <div key={c.key} class={`col-head ${c.key !== 'name' && c.key !== 'owner' ? 'num' : ''}`} style={{ width: c.width, paddingLeft: c.key === 'name' ? 16 : undefined }}>
                  {c.label}
                </div>
              ))}
            </div>
            <Timeline L={L} s={s} />
          </div>
          <div class="body-row">
            <Grid L={L} d={d} minHeight={bodyH} renamingSection={renamingSection} setRenamingSection={setRenamingSection} />
            <Chart L={L} s={s} d={d} onHover={setHover} minHeight={bodyH} onRenameSection={setRenamingSection} />
          </div>
        </div>
      </div>

      {empty && (
        <div class="empty">
          <div class="empty-card">
            <Icon name="calendar" size={36} />
            <h3>Todavía no hay tareas</h3>
            <div>Escribí en el editor, hacé doble clic en el gráfico o empezá desde una plantilla.</div>
            <div class="actions">
              <button class="btn primary" onClick={() => replaceAll(EMPTY)}><Icon name="plus" size={14} /> Proyecto vacío</button>
              <button class="btn" onClick={() => (templatesDialogOpen.value = true)}><Icon name="template" size={14} /> Usar una plantilla</button>
            </div>
          </div>
        </div>
      )}

      <FilterDock matchCount={L.matchCount} totalCount={L.totalCount} />
      {hover && <HoverCard info={hover} />}
      {inspectorOpen.value && selectedTask.value && <Inspector key={selectedTask.value.key} />}
    </>
  );
}

export { scrollToDay };

function HoverCard({ info }: { info: HoverInfo }) {
  const d = doc.value;
  const r = info.row;
  const t = r.task;
  const left = Math.min(info.clientX + 16, window.innerWidth - 300);
  const top = info.clientY + 18 > window.innerHeight - 160 ? info.clientY - 150 : info.clientY + 18;
  const days = countWorkdays(d.calendar, r.start, r.end);
  const owners = t?.spec.owners.map((o) => d.owners.get(o.toLowerCase())).filter(Boolean) ?? [];
  const statusLabel: Record<string, string> = { done: 'Hecha', active: 'En curso', blocked: 'Bloqueada' };
  return (
    <div class="tooltip" style={{ left, top }}>
      <h4>{r.label}</h4>
      {t?.spec.milestone ? (
        <div class="row"><span>Fecha</span><b>{formatMedium(r.start)}</b></div>
      ) : (
        <>
          <div class="row"><span>Inicio</span><b>{formatMedium(r.start)}</b></div>
          <div class="row"><span>Fin</span><b>{formatMedium(r.end - 1)}</b></div>
          <div class="row"><span>Duración</span><b>{days} días hábiles</b></div>
        </>
      )}
      {owners.length > 0 && (
        <div class="row">
          <span>Responsable</span>
          <b style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {owners.map((o) => (
              <span key={o!.name} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <span class={`avatar ${o!.kind === 'team' ? 'team' : ''}`} style={{ background: o!.color, width: 16, height: 16, fontSize: 8 }}>{initials(o!.name)}</span>
                {o!.name}
              </span>
            ))}
          </b>
        </div>
      )}
      {t?.spec.progress !== undefined && <div class="row"><span>Avance</span><b>{t.spec.progress}%</b></div>}
      {t?.status && <div class="row"><span>Estado</span><b>{statusLabel[t.status]}</b></div>}
      {t?.critical && <div class="row"><span>Prioridad</span><b style={{ color: 'var(--danger)' }}>Crítica</b></div>}
      {t && t.deps.length > 0 && <div class="row"><span>Después de</span><b>{t.deps.map((x) => x.spec.name).join(', ')}</b></div>}
      {r.kind === 'section' && <div class="row"><span>Tareas</span><b>{r.section.tasks.length}</b></div>}
      <div class="tip-hint">{t ? 'Doble clic: renombrar · Clic derecho: más' : 'Doble clic: colapsar · Clic derecho: más'}</div>
    </div>
  );
}
