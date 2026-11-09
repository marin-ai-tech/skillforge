// Interface language. `STR` is a live module binding to the current dictionary: existing `STR.…` reads and helpers
// outside components keep working; on a language change the binding switches and the app remounts (see main.tsx), so
// every component reads the new dictionary.
//
// English (`en.ts`) is the source of keys and the fallback. Other dictionaries are discovered at build time: a file
// `i18n/<code>.ts` exporting `<code>` of type `Messages` adds a language, with no change to this module.
import { useSyncExternalStore } from "react";
import { en, type Messages } from "./en.ts";

/** A language code, such as `en`: the name of a dictionary file in this folder. */
export type Lang = string;
export type { Messages };

// The build (Vite) replaces `import.meta.glob`; under plain Node (unit tests) there is no `import.meta.env`, and the
// interface is English only.
const FOUND: Record<string, Record<string, Messages>> = import.meta.env
  ? import.meta.glob<Record<string, Messages>>(["./*.ts", "!./index.ts", "!./en.ts"], {
      eager: true,
    })
  : {};

const DICTS: Record<Lang, Messages> = { en };
for (const [file, mod] of Object.entries(FOUND)) {
  const code = file.slice(2, -3);
  const dict = mod[code];
  if (dict) DICTS[code] = dict;
}
export const LANGS: readonly Lang[] = Object.keys(DICTS);
const dictOf = (lang: Lang): Messages => DICTS[lang] ?? en;
const STORAGE_KEY = "skillforge.lang";

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/** Saved choice, else the first browser language with a dictionary (by its primary subtag), else English. */
function detect(): Lang {
  const saved = stored();
  if (saved) return saved;
  const langs =
    typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const l of langs) {
    const primary = typeof l === "string" ? l.toLowerCase().split("-")[0] : "";
    if (primary && isLang(primary)) return primary;
  }
  return "en";
}

export let LANG: Lang = detect();
export let STR: Messages = dictOf(LANG);

function applyDocumentLang(lang: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}
applyDocumentLang(LANG);

const listeners = new Set<() => void>();

export function setLang(lang: Lang): void {
  if (lang === LANG) return;
  LANG = lang;
  STR = dictOf(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
  applyDocumentLang(lang);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => LANG);
}

/** Native name of a language, from that language's own dictionary. */
export function nativeName(lang: Lang): string {
  return dictOf(lang).meta.nativeName;
}

/** BCP 47 locale for Intl formatting, from the dictionary of the current language. */
export function locale(): string {
  return STR.meta.locale;
}

export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(locale());
}

/**
 * Server texts are English: in the English interface they are shown as sent (they carry specifics such as the
 * conflicting name); in other languages the translation by code is shown instead.
 */
function serverTextWins(fallback: string | undefined, code: string): fallback is string {
  return LANG === "en" && !!fallback && fallback !== code;
}

/** Translation of a server message by its code, or the server text when the code is not in the dictionary. */
export function codeMessage(code: string, fallback?: string): string {
  if (serverTextWins(fallback, code)) return fallback;
  const table = STR.codes as Record<string, string | undefined>;
  return table[code] ?? fallback ?? code;
}

/**
 * User-facing text of a failed request: the translation of its API `error` code (with `owner` filled in), else the
 * server message, else a generic failure. Accepts anything thrown (ApiError, Error, unknown).
 */
export function errorText(e: unknown): string {
  if (
    e &&
    typeof e === "object" &&
    "error" in e &&
    typeof (e as { error: unknown }).error === "string"
  ) {
    const err = e as { error: string; message?: string; owner?: string };
    return apiErrorMessage(err.error, err.message, { owner: err.owner ?? "" });
  }
  if (e instanceof Error && e.message) return e.message;
  return apiErrorMessage("request_failed", "Request failed");
}

/** Translation of an API `error` code; `vars` fill `{name}` placeholders. Falls back to the server message. */
export function apiErrorMessage(
  error: string,
  fallback?: string,
  vars: Record<string, string> = {},
): string {
  if (serverTextWins(fallback, error)) return fallback;
  const table = STR.apiErrors as Record<string, string | undefined>;
  const text = table[error];
  if (!text) return fallback && fallback !== error ? fallback : error;
  let missing = false;
  const filled = text.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!vars[k]) missing = true;
    return vars[k] ?? "";
  });
  // A trailing «Label: {value}» clause without a value (e.g. the owner is hidden) is dropped.
  return missing ? filled.replace(/\s*[^.:!?]*:\s*$/, "") : filled;
}
