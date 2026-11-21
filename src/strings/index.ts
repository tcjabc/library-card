import { en } from './en';

export const strings = en;
export type { Strings } from './en';

/** Replaces {key} placeholders: fmt('Hi {name}', { name: 'x' }). */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
