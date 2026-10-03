import { describe, expect, it } from 'vitest';
import { toIso, todayDay, ymd } from '../core/dates';
import { parseLooseDate } from './inputs';

describe('fechas tipeadas en el calendario', () => {
  const iso = (s: string) => {
    const d = parseLooseDate(s);
    return d === null ? null : toIso(d);
  };
  it('acepta ISO y formato día/mes/año', () => {
    expect(iso('2026-10-19')).toBe('2026-10-19');
    expect(iso('19/10/2026')).toBe('2026-10-19');
    expect(iso('19-10-26')).toBe('2026-10-19');
    expect(iso('5.3.2027')).toBe('2027-03-05');
  });
  it('sin año usa el año actual', () => {
    expect(iso('19/10')).toBe(`${ymd(todayDay()).y}-10-19`);
  });
  it('rechaza fechas imposibles o texto', () => {
    expect(iso('31/02/2026')).toBeNull();
    expect(iso('mañana')).toBeNull();
  });
});
