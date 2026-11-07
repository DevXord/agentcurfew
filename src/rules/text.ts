import type { Component } from '../inventory/types.ts';

/** True when the component's raw is the text of its file, so positions in it are positions in the file. */
export function isWholeFile(component: Component): boolean {
  if (component.kind === 'skill') return true;
  return component.name === component.file.slice(component.file.lastIndexOf('/') + 1);
}

/** Code points in text[from, to): each UTF-16 unit except the second half of a surrogate pair. */
function codePoints(text: string, from: number, to: number): number {
  let count = 0;
  for (let index = from; index < to; index++) {
    const unit = text.charCodeAt(index);
    // The second half of a pair is not counted, also when the count starts between the halves.
    if (unit < 0xdc00 || unit > 0xdfff || index === 0 || !isHigh(text.charCodeAt(index - 1))) count++;
  }
  return count;
}

function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/**
 * Lines and columns of many indexes into one text. Line starts are found once and a column is counted on from the
 * last index asked for, so a rule that reports thousands of places in a long line costs linear time, not quadratic.
 */
class Locator {
  readonly #text: string;
  readonly #starts: number[] = [0];
  #last = { index: 0, line: 0, column: 1 };

  constructor(text: string) {
    this.#text = text;
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) this.#starts.push(at + 1);
  }

  locate(index: number): { line: number; column: number } {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.#starts[middle] ?? 0) <= index) low = middle;
      else high = middle - 1;
    }
    const start = this.#starts[low] ?? 0;
    const last = this.#last;
    const column = last.line === low && last.index <= index ? last.column + codePoints(this.#text, last.index, index) : 1 + codePoints(this.#text, start, index);
    this.#last = { index, line: low, column };
    return { line: low + 1, column };
  }
}

/** 1-based line and column, in code points, of an index into text. */
export function position(text: string, index: number): { line: number; column: number } {
  return new Locator(text).locate(index);
}

/** Every text a component holds, with where it comes from: its own raw, and for a skill each text file of its folder. */
export function texts(component: Component): { text: string; inFile?: string; whole: boolean }[] {
  const list: { text: string; inFile?: string; whole: boolean }[] = [{ text: component.raw, whole: isWholeFile(component) }];
  const entry = component.file.slice(component.file.lastIndexOf('/') + 1);
  for (const file of component.files ?? []) {
    if (file.raw !== undefined && file.path !== entry) list.push({ text: file.raw, inFile: file.path, whole: true });
  }
  return list;
}

/** A hit placed at an index of one of the component's texts. */
const locators = new WeakMap<object, Locator>();

/** Where an index into a source lies; repeated calls with the same source object share one Locator. */
export function at(source: { text: string; inFile?: string; whole: boolean }, index: number): { line?: number; column?: number; inFile?: string } {
  let locator = locators.get(source);
  if (locator === undefined && source.whole) {
    locator = new Locator(source.text);
    locators.set(source, locator);
  }
  const place = locator === undefined ? {} : locator.locate(index);
  return source.inFile === undefined ? place : { ...place, inFile: source.inFile };
}

/** The parsed JSON of an entry component, or undefined. */
export function entryValue(component: Component): unknown {
  if (isWholeFile(component)) return undefined;
  try {
    return JSON.parse(component.raw) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every string inside a value, with the key that holds it (the nearest object key). */
export function strings(value: unknown, key = ''): { key: string; value: string }[] {
  if (typeof value === 'string') return [{ key, value }];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  if (isRecord(value)) return Object.entries(value).flatMap(([inner, item]) => strings(item, inner));
  return [];
}
