import type { Day } from './dates';
import { parse } from './parser';
import { schedule } from './schedule';
import type { GanttDoc } from './types';

/** Texto → documento parseado y planificado. */
export function compile(text: string, today: Day): GanttDoc {
  const doc = parse(text);
  return schedule(doc, doc.today ?? today);
}

let lastText: string | null = null;
let lastToday: Day | null = null;
let lastDoc: GanttDoc | null = null;

/** Igual que `compile`, pero reutiliza el resultado si el texto no cambió (editor, linter y UI lo comparten). */
export function compileCached(text: string, today: Day): GanttDoc {
  if (text !== lastText || today !== lastToday || !lastDoc) {
    lastDoc = compile(text, today);
    lastText = text;
    lastToday = today;
  }
  return lastDoc;
}
