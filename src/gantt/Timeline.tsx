import { signal } from '@preact/signals';
import type { ViewSettings } from '../core/types';
import { HEADER_TIER, type Layout, type Tick } from '../render/layout';
import { textWidth, truncate } from '../render/text';
import { fitPeriod, presenting } from '../state/store';
import { openHeaderMenu } from './menus';
import { panJustEnded } from './pan';

/** Desplazamiento horizontal del gráfico (solo lo lee el encabezado, para fijar las etiquetas). */
export const scrollX = signal(0);

const FONT_TOP = '600 11px Inter, system-ui, sans-serif';
const FONT_BOTTOM = '400 11px Inter, system-ui, sans-serif';
const FONT_SPRINT = '600 10.5px Inter, system-ui, sans-serif';

/** Encabezado del eje temporal: dos niveles (más una fila de sprints si corresponde). */
export function Timeline({ L, s }: { L: Layout; s: ViewSettings }) {
  const H = L.headerH;
  const todayX = (L.today - L.rangeStart) * L.pxPerDay;
  const showToday = s.features.today && L.today >= L.rangeStart && L.today <= L.rangeEnd;
  const sx = scrollX.value;
  const topH = HEADER_TIER.top;
  const sprintY = topH;
  const bottomY = topH + (L.sprintTier.length ? HEADER_TIER.sprint : 0);

  /** Etiqueta que "se pega" al borde izquierdo visible mientras su período sigue en pantalla. */
  const stickyX = (t: Tick, lw: number) => Math.max(t.x + 8, Math.min(sx + 8, t.x + t.w - lw - 8));

  const tickProps = (t: Tick) => ({
    class: 'tick-hit',
    onDblClick: () => !panJustEnded() && fitPeriod(t.start, t.end),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!presenting.value) openHeaderMenu(e, t);
    },
  });

  return (
    <svg
      class="timeline"
      width={L.width}
      height={H}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!presenting.value) openHeaderMenu(e, null);
      }}
    >
      {/* Nivel superior */}
      {L.top.map((t) => {
        const isSprint = s.scale === 'sprint';
        const label = truncate(t.label, t.w - 14, FONT_TOP);
        const lw = textWidth(label, FONT_TOP);
        return (
          <g key={t.key}>
            <rect x={t.x} y={0} width={Math.max(0, t.w)} height={topH} {...tickProps(t)}>
              <title>{t.title ?? `${t.label} · doble clic para ajustar`}</title>
            </rect>
            <line class={`tick-line ${isSprint ? 'sprint' : ''}`} x1={t.x + 0.5} x2={t.x + 0.5} y1={0} y2={H} />
            {label && <text class="tick-top" x={stickyX(t, lw)} y={16}>{label}</text>}
          </g>
        );
      })}
      <line class="tick-line" x1={0} x2={L.width} y1={topH + 0.5} y2={topH + 0.5} />

      {/* Fila de sprints (cuando la escala no es "sprint") */}
      {L.sprintTier.length > 0 && (
        <g>
          {L.sprintTier.map((t, i) => {
            const label = truncate(t.label, t.w - 12, FONT_SPRINT);
            const lw = textWidth(label, FONT_SPRINT);
            return (
              <g key={t.key}>
                <rect x={t.x} y={sprintY} width={Math.max(0, t.w)} height={HEADER_TIER.sprint} {...tickProps(t)} class={`tick-hit sprint-cell ${i % 2 ? 'odd' : ''}`}>
                  <title>{t.title}</title>
                </rect>
                <line class="tick-line sprint" x1={t.x + 0.5} x2={t.x + 0.5} y1={sprintY} y2={sprintY + HEADER_TIER.sprint} />
                {label && <text class="tick-sprint" x={stickyX(t, lw)} y={sprintY + 14}>{label}</text>}
              </g>
            );
          })}
          <line class="tick-line" x1={0} x2={L.width} y1={bottomY + 0.5} y2={bottomY + 0.5} />
        </g>
      )}

      {/* Nivel inferior */}
      {L.bottom.map((t) => {
        const fits = textWidth(t.label, FONT_BOTTOM) + 6 <= t.w;
        return (
          <g key={t.key}>
            <rect x={t.x} y={bottomY} width={Math.max(0, t.w)} height={HEADER_TIER.bottom} {...tickProps(t)} />
            <line class="tick-line" x1={t.x + 0.5} x2={t.x + 0.5} y1={bottomY} y2={H} opacity={0.7} />
            {fits && (
              <text class="tick-bottom" x={t.x + t.w / 2} y={bottomY + 20} text-anchor="middle" font-weight={t.strong ? 600 : 400}>
                {t.label}
              </text>
            )}
          </g>
        );
      })}

      {showToday && (
        <g class="today-marker" style={{ transform: `translateX(${todayX}px)` }}>
          <rect class="today-pill" x={-18} y={H - 17} width={36} height={15} rx={7.5} />
          <text class="today-text" x={0} y={H - 6.5} text-anchor="middle">Hoy</text>
        </g>
      )}
    </svg>
  );
}
