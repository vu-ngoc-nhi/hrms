import { en } from "./messages/en";

// Localization-ready message lookup. Only English exists today; a new locale must provide the same key shape.
export type Messages = typeof en;
const catalogs: Record<string, Messages> = { en };
export const DEFAULT_LOCALE = "en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function format(template: string, vars?: Record<string, string | number>) {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : template;
}

export function t(key: MessageKey, vars?: Record<string, string | number>, locale = DEFAULT_LOCALE): string {
  return format(lookup(catalogs[locale] ?? en, key) ?? lookup(en, key) ?? key, vars);
}

/** For keys built at runtime from API codes (statuses, error codes); returns undefined when not catalogued. */
export function tMaybe(key: string, vars?: Record<string, string | number>, locale = DEFAULT_LOCALE): string | undefined {
  const found = lookup(catalogs[locale] ?? en, key) ?? lookup(en, key);
  return found === undefined ? undefined : format(found, vars);
}

export function formatDate(iso: string | null | undefined, locale = DEFAULT_LOCALE): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
