import { signal } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { marked } from 'marked';
import docsMd from '../../docs/SINTAXIS.md?raw';
import { slugify } from '../core/lexer';
import { helpOpen, toast } from '../state/store';
import { Icon } from './icons';
import { Select } from './inputs';

const helpAnchor = signal<string | null>(null);

/** Abre la ayuda directamente en una sección (id = slug del encabezado). */
export function openHelpAt(id: string) {
  helpAnchor.value = id;
  helpOpen.value = true;
}

interface TocItem {
  id: string;
  title: string;
  children: { id: string; title: string }[];
}

/** Índice a partir de los encabezados ## y ### del Markdown. */
function buildToc(md: string): TocItem[] {
  const toc: TocItem[] = [];
  for (const m of md.matchAll(/^(##|###) (.+)$/gm)) {
    const title = m[2].trim();
    if (m[1] === '##') toc.push({ id: slugify(title), title, children: [] });
    else toc[toc.length - 1]?.children.push({ id: slugify(title), title });
  }
  return toc;
}

export function HelpDrawer() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState<{ h2: string; h3: string | null }>({ h2: '', h3: null });
  const html = useMemo(() => marked.parse(docsMd, { async: false }) as string, []);
  const toc = useMemo(() => buildToc(docsMd), []);

  const close = () => {
    setClosing(true);
    setTimeout(() => {
      helpOpen.value = false;
      setClosing(false);
    }, 180);
  };

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    // Ids para los encabezados (el índice salta a ellos)
    body.querySelectorAll('h2, h3').forEach((h) => (h.id = slugify(h.textContent ?? '')));
    // Botones "Copiar" en los bloques de código
    body.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.className = 'copy-code';
      btn.textContent = 'Copiar';
      btn.onclick = () => {
        navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? '').then(() => toast('Ejemplo copiado', 'success'));
      };
      pre.appendChild(btn);
    });
    // Scrollspy: marcar la sección visible
    const onScroll = () => {
      const y = body.scrollTop + 90;
      let h2 = toc[0]?.id ?? '';
      let h3: string | null = null;
      body.querySelectorAll<HTMLElement>('h2, h3').forEach((h) => {
        if (h.offsetTop > y) return;
        if (h.tagName === 'H2') {
          h2 = h.id;
          h3 = null;
        } else h3 = h.id;
      });
      setActive((a) => (a.h2 === h2 && a.h3 === h3 ? a : { h2, h3 }));
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    // Abrir directo en una sección pedida
    if (helpAnchor.value) {
      const target = body.querySelector<HTMLElement>(`#${CSS.escape(helpAnchor.value)}`);
      if (target) body.scrollTop = target.offsetTop - 16;
      helpAnchor.value = null;
    }
    onScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      body.removeEventListener('scroll', onScroll);
    };
  }, []);

  const jump = (id: string) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el && bodyRef.current) bodyRef.current.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
  };

  return (
    <>
      <div class="drawer-overlay" onClick={close} style={closing ? { opacity: 0, transition: 'opacity 180ms' } : undefined} />
      <div class="drawer help" style={closing ? { transform: 'translateX(100%)', transition: 'transform 180ms ease-in' } : undefined} role="dialog" aria-label="Ayuda">
        <div class="drawer-head">
          <Icon name="help" />
          <h2>Guía de GanttMaker</h2>
          <span class="spacer" />
          <div class="help-jump">
            <Select
              value={active.h2}
              options={toc.map((t) => ({ value: t.id, label: t.title }))}
              onChange={jump}
              searchable={false}
            />
          </div>
          <button class="icon-btn" onClick={close} title="Cerrar (Esc)"><Icon name="x" /></button>
        </div>
        <div class="help-layout">
          <nav class="help-toc" aria-label="Contenido">
            {toc.map((t) => (
              <div key={t.id} class={`toc-group ${active.h2 === t.id ? 'open' : ''}`}>
                <button class={`toc-item ${active.h2 === t.id ? 'active' : ''}`} onClick={() => jump(t.id)}>
                  {t.title}
                </button>
                {t.children.length > 0 && (
                  <div class="toc-sub">
                    <div>
                      {t.children.map((c) => (
                        <button key={c.id} class={`toc-item sub ${active.h3 === c.id ? 'active' : ''}`} onClick={() => jump(c.id)}>
                          {c.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div class="drawer-body" ref={bodyRef}>
            <article class="doc" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </>
  );
}
