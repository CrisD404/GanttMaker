// Fechas como números enteros de días desde 1970-01-01 (UTC).
// Trabajar con enteros evita los problemas de zona horaria y horario de verano.

export type Day = number;

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIso(s: string): Day | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCDate() !== d) return null; // 2026-02-31, etc.
  return Math.round(ms / MS_PER_DAY);
}

export function isIsoDate(s: string): boolean {
  return parseIso(s) !== null;
}

export function toIso(day: Day): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function todayDay(): Day {
  const now = new Date();
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

export function toDate(day: Day): Date {
  return new Date(day * MS_PER_DAY);
}

/** 0 = domingo … 6 = sábado */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7; // 1970-01-01 fue jueves
}

export function ymd(day: Day): { y: number; m: number; d: number } {
  const dt = toDate(day);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

export function fromYmd(y: number, m: number, d: number): Day {
  return Math.round(Date.UTC(y, m, d) / MS_PER_DAY);
}

export function startOfWeek(day: Day): Day {
  const wd = weekday(day);
  return day - ((wd + 6) % 7); // semanas que empiezan el lunes
}

export function startOfMonth(day: Day): Day {
  const { y, m } = ymd(day);
  return fromYmd(y, m, 1);
}

export function addMonths(day: Day, n: number): Day {
  const { y, m, d } = ymd(day);
  return fromYmd(y, m + n, d);
}

export function startOfQuarter(day: Day): Day {
  const { y, m } = ymd(day);
  return fromYmd(y, m - (m % 3), 1);
}

export function startOfYear(day: Day): Day {
  return fromYmd(ymd(day).y, 0, 1);
}

/** Número de semana ISO-8601. */
export function isoWeek(day: Day): number {
  const thursday = day + 3 - ((weekday(day) + 6) % 7);
  const yearStart = fromYmd(ymd(thursday).y, 0, 1);
  return 1 + Math.floor((thursday - yearStart) / 7);
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export function monthShort(m: number): string { return MONTHS_SHORT[m]; }
export function monthLong(m: number): string { return MONTHS_LONG[m]; }
export function weekdayLetter(day: Day): string { return WEEKDAYS_SHORT[weekday(day)]; }

/** "2 nov" */
export function formatShort(day: Day): string {
  const { m, d } = ymd(day);
  return `${d} ${MONTHS_SHORT[m]}`;
}

/** "2 nov 2026" */
export function formatMedium(day: Day): string {
  const { y, m, d } = ymd(day);
  return `${d} ${MONTHS_SHORT[m]} ${y}`;
}

// ---------------------------------------------------------------------------
// Calendario laboral
// ---------------------------------------------------------------------------

export interface Calendar {
  /** workdays[wd] === true si ese día de la semana es laborable (0 = domingo). */
  workdays: boolean[];
  holidays: Set<Day>;
}

export const DEFAULT_CALENDAR: Calendar = {
  workdays: [false, true, true, true, true, true, false],
  holidays: new Set(),
};

const WD_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Interpreta "mon-fri", "all", "mon,wed,fri", "mon-sat". Devuelve null si es inválido. */
export function parseWorkdays(spec: string): boolean[] | null {
  const s = spec.trim().toLowerCase();
  if (s === 'all' || s === 'every day' || s === 'everyday') return [true, true, true, true, true, true, true];
  const days = [false, false, false, false, false, false, false];
  for (const part of s.split(/\s*,\s*/)) {
    if (!part) continue;
    const range = part.split('-');
    if (range.length === 2) {
      const a = WD_NAMES[range[0]], b = WD_NAMES[range[1]];
      if (a === undefined || b === undefined) return null;
      for (let i = a; ; i = (i + 1) % 7) {
        days[i] = true;
        if (i === b) break;
      }
    } else {
      const a = WD_NAMES[part];
      if (a === undefined) return null;
      days[a] = true;
    }
  }
  return days.some(Boolean) ? days : null;
}

export function isWorkday(cal: Calendar, day: Day): boolean {
  return cal.workdays[weekday(day)] && !cal.holidays.has(day);
}

export function nextWorkday(cal: Calendar, day: Day): Day {
  let d = day;
  for (let i = 0; i < 3660 && !isWorkday(cal, d); i++) d++;
  return d;
}

/** Suma `n` días laborables empezando en `start` (inclusive). Devuelve el fin exclusivo. */
export function addWorkdays(cal: Calendar, start: Day, n: number): Day {
  if (n <= 0) return start;
  let d = nextWorkday(cal, start);
  let left = n;
  while (true) {
    left--;
    if (left === 0) return d + 1;
    d = nextWorkday(cal, d + 1);
  }
}

/** Días laborables en [start, end). */
export function countWorkdays(cal: Calendar, start: Day, end: Day): number {
  let n = 0;
  for (let d = start; d < end; d++) if (isWorkday(cal, d)) n++;
  return n;
}

export function workdaysPerWeek(cal: Calendar): number {
  return cal.workdays.filter(Boolean).length;
}
