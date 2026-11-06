import type { Component } from '../inventory/types.ts';

/** True when the component's raw is the text of its file, so positions in it are positions in the file. */
export function isWholeFile(component: Component): boolean {
  if (component.kind === 'skill') return true;
  return component.name === component.file.slice(component.file.lastIndexOf('/') + 1);
}

/** 1-based line and column, in code points, of an index into text. */
export function position(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) {
    line++;
    start = at + 1;
  }
  return { line, column: [...text.slice(start, index)].length + 1 };
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
export function at(source: { text: string; inFile?: string; whole: boolean }, index: number): { line?: number; column?: number; inFile?: string } {
  const place = source.whole ? position(source.text, index) : {};
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
