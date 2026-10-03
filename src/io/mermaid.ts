// Importa un diagrama `gantt` de Mermaid y lo convierte al DSL de GanttMaker.

const MERMAID_DURATION = /^(\d+(?:\.\d+)?)\s*([dwh])$/i;

export function looksLikeMermaid(text: string): boolean {
  return /^\s*gantt\s*$/m.test(text) && /^\s*[^:\n]+:\s*.+$/m.test(text);
}

export function mermaidToGantt(text: string): string {
  const out: string[] = [];
  const ids = new Map<string, string>(); // id de mermaid → nombre de la tarea
  let title = 'Importado de Mermaid';
  const body: string[] = [];
  let excludesWeekends = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%') || line === 'gantt') continue;
    const kw = /^(title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|section)\b\s*(.*)$/i.exec(line);
    if (kw) {
      const k = kw[1].toLowerCase();
      const v = kw[2].trim();
      if (k === 'title') title = v;
      else if (k === 'excludes' && /weekends/i.test(v)) excludesWeekends = true;
      else if (k === 'section') body.push('', `section ${v}`);
      continue;
    }
    const m = /^(.+?)\s*:\s*(.+)$/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    const parts = m[2].split(',').map((p) => p.trim()).filter(Boolean);
    const attrs: string[] = [];
    let milestone = false;
    const tags: string[] = [];
    let id: string | undefined;
    const rest: string[] = [];
    for (const p of parts) {
      const low = p.toLowerCase();
      if (['done', 'active', 'crit'].includes(low)) tags.push(low);
      else if (low === 'milestone') milestone = true;
      else rest.push(p);
    }
    // Mermaid: [id], [inicio | after x], fin|duración
    if (rest.length === 3 || (rest.length === 2 && !/^\d{4}-|^after\s/i.test(rest[0]) && !MERMAID_DURATION.test(rest[0]))) {
      id = rest.shift();
    }
    for (const p of rest) {
      const dur = MERMAID_DURATION.exec(p);
      if (/^after\s+/i.test(p)) attrs.push('@@after:' + p.replace(/^after\s+/i, '').trim().split(/\s+/).join('|'));
      else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) attrs.push(p);
      else if (dur) {
        const n = parseFloat(dur[1]);
        const unit = dur[2].toLowerCase();
        if (unit === 'h') attrs.push(`${Math.max(1, Math.ceil(n / 8))}d`);
        else attrs.push(`${Math.round(n)}${unit}`);
      }
    }
    if (id) ids.set(id, name);
    body.push(`  ${/[@#,]|\b\d+[dw]\b|\d{4}-\d{2}-\d{2}/.test(name) ? `"${name}"` : name} ${[...attrs, milestone ? 'milestone' : '', ...tags.map((t) => `#${t}`)].filter(Boolean).join(' ')}`.trimEnd());
  }

  out.push(`gantt "${title.replace(/"/g, "'")}"`);
  if (excludesWeekends) out.push('calendar mon-fri');
  else out.push('calendar all');
  // Resolver "after id1 id2" de Mermaid a nombres
  const resolved = body.map((l) =>
    l.replace(/@@after:(\S+)/, (_, refs: string) => 'after ' + refs.split('|').map((r) => ids.get(r) ?? r).join(', ')),
  );
  return [...out, ...resolved].join('\n') + '\n';
}
