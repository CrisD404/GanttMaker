// Tokenizador de líneas del DSL. Una línea = una instrucción.

export interface Token {
  /** Texto tal cual aparece (con comillas si las tiene). */
  raw: string;
  /** Texto sin comillas. */
  value: string;
  from: number;
  to: number;
  quoted: boolean;
}

export const DURATION_RE = /^(\d+)([dw])$/i;
export const PROGRESS_RE = /^(\d{1,3})%$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Separa el código del comentario `// ...` (ignorando `//` dentro de comillas). */
export function splitComment(line: string): { code: string; comment: string } {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === '/' && line[i + 1] === '/') {
      return { code: line.slice(0, i).replace(/\s+$/, ''), comment: line.slice(i) };
    }
  }
  return { code: line.replace(/\s+$/, ''), comment: '' };
}

export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    while (i < n && /\s/.test(code[i])) i++;
    if (i >= n) break;
    const from = i;
    let quoted = false;
    while (i < n && !/\s/.test(code[i])) {
      if (code[i] === '"') {
        quoted = true;
        i++;
        while (i < n && code[i] !== '"') i++;
        if (i < n) i++; // comilla de cierre
      } else {
        i++;
      }
    }
    const raw = code.slice(from, i);
    out.push({ raw, value: raw.replace(/"/g, ''), from, to: i, quoted });
  }
  return out;
}

/** ¿El token es un atributo de tarea (y por lo tanto termina el nombre)? */
export function isAttrToken(t: Token): boolean {
  const v = t.raw;
  if (v.startsWith('@') || (v.startsWith('#') && v.length > 1)) return true;
  if (t.quoted) return false;
  const lower = v.toLowerCase();
  return (
    DURATION_RE.test(v) ||
    PROGRESS_RE.test(v) ||
    DATE_RE.test(v) ||
    RANGE_RE.test(v) ||
    lower === 'after' ||
    lower === 'milestone' ||
    lower.startsWith('id:') ||
    v === '->' ||
    v === '..'
  );
}

/** Pone comillas a un nombre si contiene algo que el parser interpretaría como atributo. */
export function quoteIfNeeded(name: string): string {
  if (!name) return '""';
  const toks = tokenize(name);
  const needs =
    name.includes('//') ||
    name.includes(',') ||
    toks.some(isAttrToken) ||
    /^\s|\s$/.test(name);
  return needs ? `"${name.replace(/"/g, "'")}"` : name;
}

/** Convierte un nombre en un identificador simple: "Diseño UX" → "diseno-ux". */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';
}
