import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createNewsPost, NewsPostError, patchNewsPost } from "../api/client.ts";
import type { NewsItem, NewsPostInput } from "../api/types.ts";
import type { NewsAudience } from "../lib/news-audience.ts";
import { Markdown } from "./Markdown.tsx";
import { Button } from "./Button.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

type Field = "title" | "body" | "audience" | "publish_at" | "expires_at";
const FIELD_ORDER: Field[] = ["title", "body", "audience", "publish_at", "expires_at"];
type Errors = Partial<Record<Field | "", string>>;

type Values = {
  title: string;
  body: string;
  audience: string;
  pinned: boolean;
  important: boolean;
  publishAt: string;
  expiresAt: string;
};

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const pad = (n: number) => String(n).padStart(2, "0");
/** A moment as the value of a datetime-local input, in the browser's zone. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const isoToLocal = (iso: string | null | undefined) => (iso ? toLocalInput(new Date(iso)) : "");
const AHEAD_MS = 365 * 86_400_000;

/** The select value of the everyone audience; "" is «not chosen yet». */
const EVERYONE = "*";
const audienceValue = (team: string | null) => (team === null ? EVERYONE : team);

/** The starting audience: the post's own when editing; a lead with exactly one team gets it; otherwise none. */
function initialAudience(audiences: NewsAudience[], editing: NewsItem | null): string {
  if (editing?.post) return audienceValue(editing.post.team);
  const only = audiences.length === 1 ? audiences[0] : undefined;
  return only && only.team !== null ? only.team : "";
}

function validate(v: Values, audiences: NewsAudience[]): Errors {
  const e: Errors = {};
  const title = v.title.trim();
  if (!title) e.title = STR.news.form.titleRequired;
  else if (title.length > 200) e.title = STR.news.form.titleTooLong;
  if (v.body.length > 20000) e.body = STR.news.form.bodyTooLong;
  if (!audiences.some((a) => audienceValue(a.team) === v.audience))
    e.audience = STR.news.form.audienceRequired;
  if (v.publishAt && new Date(v.publishAt).getTime() > Date.now() + AHEAD_MS)
    e.publish_at = STR.news.form.tooFar;
  if (v.publishAt && v.expiresAt && new Date(v.expiresAt) <= new Date(v.publishAt)) {
    e.expires_at = STR.news.form.expiresBeforePublish;
  }
  return e;
}

/** Server field names to form fields; `team` is the audience select. */
function serverErrors(err: unknown): Errors {
  if (!(err instanceof NewsPostError)) return { "": errorText(err) };
  const out: Errors = {};
  for (const [k, msg] of Object.entries(err.fields)) {
    const f = k === "team" ? "audience" : k;
    if ((FIELD_ORDER as string[]).includes(f)) out[f as Field] = msg;
    else out[""] = out[""] ? `${out[""]} ${msg}` : msg;
  }
  return out;
}

function inputBody(v: Values, draft: boolean): NewsPostInput {
  return {
    title: v.title.trim(),
    body: v.body,
    team: v.audience === EVERYONE ? null : v.audience || null,
    pinned: v.pinned,
    important: v.important,
    draft,
    publish_at: toIso(v.publishAt),
    expires_at: toIso(v.expiresAt),
  };
}

const fieldClass =
  "w-full rounded-sf border border-line bg-bg px-3 py-2 text-sm text-ink aria-invalid:border-danger";

function FieldError({ id, testId, text }: { id: string; testId: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} data-testid={testId} className="mt-1 text-xs text-danger">
      {text}
    </p>
  );
}

type Props = {
  audiences: NewsAudience[];
  /** The post being edited (saved with PATCH); null for a new post. */
  editing?: NewsItem | null;
  onDone: (saved: NewsItem) => void;
  onCancel: () => void;
  /** Called when the form starts or stops holding unsaved text (title or body changed). */
  onDirtyChange?: (dirty: boolean) => void;
};

/** The post form: title, Markdown text with preview, audience (allowed options only), pin, important, times. */
export function NewsPostForm({
  audiences,
  editing = null,
  onDone,
  onCancel,
  onDirtyChange,
}: Props) {
  const qc = useQueryClient();
  const uid = useId().replace(/:/g, "");
  const ids = (f: string) => `news-${uid}-${f}`;
  const [initial] = useState<Values>(() => {
    const p = editing?.post;
    return {
      title: p?.title ?? "",
      body: p?.body ?? "",
      audience: initialAudience(audiences, editing),
      pinned: p?.pinned ?? false,
      important: p?.important ?? false,
      publishAt: isoToLocal(p?.publish_at),
      expiresAt: isoToLocal(p?.expires_at),
    };
  });
  const [v, setV] = useState<Values>(initial);
  const [limits] = useState(() => {
    const now = new Date();
    return { min: toLocalInput(now), max: toLocalInput(new Date(now.getTime() + AHEAD_MS)) };
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dirty = v.title !== initial.title || v.body !== initial.body;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [errors, setErrors] = useState<Errors>({});
  const [preview, setPreview] = useState(false);
  const refs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    refs.current.title?.focus();
  }, []);
  useEffect(() => {
    if (focusTick === 0) return;
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (first === "body") setPreview(false);
    if (first) refs.current[first]?.focus();
  }, [focusTick, errors]);

  const mut = useMutation({
    mutationFn: (draft: boolean) => {
      const body = inputBody(v, draft);
      if (!editing) return createNewsPost(body);
      // Unchanged times are not sent again: a published post's publish_at is already in the past.
      if (v.publishAt === initial.publishAt) delete body.publish_at;
      if (v.expiresAt === initial.expiresAt) delete body.expires_at;
      return patchNewsPost(editing.id, body);
    },
    onSuccess: async (saved) => {
      onDirtyChange?.(false);
      await qc.invalidateQueries({ queryKey: ["news"] });
      onDone(saved);
    },
    onError: (err) => {
      setErrors(serverErrors(err));
      setFocusTick((n) => n + 1);
    },
  });

  const submit = (draft: boolean) => {
    const e = validate(v, audiences);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setFocusTick((n) => n + 1);
      return;
    }
    mut.mutate(draft);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };
  const set = <K extends keyof Values>(k: K, value: Values[K]) =>
    setV((p) => ({ ...p, [k]: value }));
  const listed = Object.entries(errors).filter(([, m]) => !!m);
  const invalid = (f: Field) => (errors[f] ? true : undefined);
  const described = (f: Field) => (errors[f] ? ids(`${f}-error`) : undefined);
  const describedWithHint = (f: Field) =>
    [ids(`${f}-hint`), described(f)].filter(Boolean).join(" ");
  const chosen = audiences.find((a) => audienceValue(a.team) === v.audience);
  const publishLabel = !chosen
    ? STR.news.form.publish
    : chosen.team === null
      ? STR.news.form.publishForEveryone
      : STR.news.form.publishFor(chosen.label);

  return (
    <form
      data-testid="news-form"
      aria-labelledby={ids("heading")}
      noValidate
      onSubmit={onSubmit}
      className="space-y-4 rounded-sf border border-line bg-surface p-4"
    >
      <h2 id={ids("heading")} className="text-base font-semibold">
        {editing ? STR.news.form.headingEdit : STR.news.form.heading}
      </h2>
      {listed.length > 0 ? (
        <div
          role="alert"
          data-testid="news-form-summary"
          className="rounded-sf border border-danger p-3 text-sm"
        >
          <p className="font-medium text-danger">{STR.news.form.summary}</p>
          <ul className="list-disc pl-5 text-ink-2">
            {listed.map(([f, m]) => (
              <li key={f || "general"}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <label htmlFor={ids("title")} className="mb-1 block text-sm font-medium">
          {STR.news.form.title}
        </label>
        <input
          id={ids("title")}
          ref={(el) => {
            refs.current.title = el;
          }}
          data-testid="news-form-title"
          type="text"
          value={v.title}
          maxLength={400}
          aria-invalid={invalid("title")}
          aria-describedby={described("title")}
          onChange={(e) => set("title", e.target.value)}
          className={fieldClass}
        />
        <FieldError id={ids("title-error")} testId="news-form-title-error" text={errors.title} />
      </div>
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={ids("body")} className="text-sm font-medium">
            {STR.news.form.body}
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
              className="min-h-6 rounded-sf border border-line px-2 py-0.5 text-xs aria-pressed:bg-surface-2"
            >
              {STR.news.form.write}
            </button>
            <button
              type="button"
              data-testid="news-form-preview"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
              className="min-h-6 rounded-sf border border-line px-2 py-0.5 text-xs aria-pressed:bg-surface-2"
            >
              {STR.news.form.preview}
            </button>
          </div>
        </div>
        {preview ? (
          <div
            data-testid="news-form-preview-body"
            className="min-h-24 rounded-sf border border-line p-3"
          >
            {v.body.trim() ? (
              <Markdown source={v.body} />
            ) : (
              <p className="text-sm text-muted">{STR.news.form.previewEmpty}</p>
            )}
          </div>
        ) : (
          <textarea
            id={ids("body")}
            ref={(el) => {
              refs.current.body = el;
            }}
            data-testid="news-form-body"
            rows={6}
            value={v.body}
            aria-invalid={invalid("body")}
            aria-describedby={described("body")}
            onChange={(e) => set("body", e.target.value)}
            className={`${fieldClass} font-mono`}
          />
        )}
        <FieldError id={ids("body-error")} testId="news-form-body-error" text={errors.body} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={ids("audience")} className="mb-1 block text-sm font-medium">
            {STR.news.form.audience}
          </label>
          <select
            id={ids("audience")}
            ref={(el) => {
              refs.current.audience = el;
            }}
            data-testid="news-form-audience"
            value={v.audience}
            aria-invalid={invalid("audience")}
            aria-describedby={described("audience")}
            onChange={(e) => set("audience", e.target.value)}
            className={fieldClass}
          >
            {initialAudience(audiences, null) === "" ? (
              <option value="">{STR.news.form.audiencePlaceholder}</option>
            ) : null}
            {audiences.map((a) => (
              <option key={audienceValue(a.team)} value={audienceValue(a.team)}>
                {a.team === null ? STR.news.form.everyone : a.label}
              </option>
            ))}
          </select>
          <FieldError
            id={ids("audience-error")}
            testId="news-form-audience-error"
            text={errors.audience}
          />
        </div>
        <div>
          <label htmlFor={ids("publish_at")} className="mb-1 block text-sm font-medium">
            {STR.news.form.publishAt}
          </label>
          <input
            id={ids("publish_at")}
            ref={(el) => {
              refs.current.publish_at = el;
            }}
            data-testid="news-form-publish-at"
            type="datetime-local"
            value={v.publishAt}
            min={limits.min}
            max={limits.max}
            aria-invalid={invalid("publish_at")}
            aria-describedby={describedWithHint("publish_at")}
            onChange={(e) => set("publishAt", e.target.value)}
            className={fieldClass}
          />
          <p id={ids("publish_at-hint")} className="mt-1 text-xs text-muted">
            {STR.news.form.localTime(tz)}
          </p>
          <FieldError
            id={ids("publish_at-error")}
            testId="news-form-publish-at-error"
            text={errors.publish_at}
          />
        </div>
        <div>
          <label htmlFor={ids("expires_at")} className="mb-1 block text-sm font-medium">
            {STR.news.form.expiresAt}
          </label>
          <input
            id={ids("expires_at")}
            ref={(el) => {
              refs.current.expires_at = el;
            }}
            data-testid="news-form-expires-at"
            type="datetime-local"
            value={v.expiresAt}
            min={limits.min}
            aria-invalid={invalid("expires_at")}
            aria-describedby={describedWithHint("expires_at")}
            onChange={(e) => set("expiresAt", e.target.value)}
            className={fieldClass}
          />
          <p id={ids("expires_at-hint")} className="mt-1 text-xs text-muted">
            {STR.news.form.localTimeExpires(tz)}
          </p>
          <FieldError
            id={ids("expires_at-error")}
            testId="news-form-expires-at-error"
            text={errors.expires_at}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex min-h-6 items-center gap-2">
          <input
            type="checkbox"
            data-testid="news-form-pinned"
            className="h-4 w-4"
            checked={v.pinned}
            onChange={(e) => set("pinned", e.target.checked)}
          />
          {STR.news.form.pin}
        </label>
        <label className="inline-flex min-h-6 items-center gap-2">
          <input
            type="checkbox"
            data-testid="news-form-important"
            className="h-4 w-4"
            checked={v.important}
            onChange={(e) => set("important", e.target.checked)}
          />
          {STR.news.form.important}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <HelpTip action="news-form-submit">
          <Button
            type="submit"
            data-testid="news-form-submit"
            pending={mut.isPending}
            className="min-h-6 rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
          >
            {publishLabel}
          </Button>
        </HelpTip>
        <HelpTip action="news-form-draft">
          <Button
            type="button"
            data-testid="news-form-draft"
            pending={mut.isPending}
            onClick={() => submit(true)}
            className="min-h-6 rounded-sf border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
          >
            {STR.news.form.saveDraft}
          </Button>
        </HelpTip>
        <button
          type="button"
          data-testid="news-form-cancel"
          onClick={onCancel}
          className="min-h-6 rounded-sf border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          {STR.news.form.cancel}
        </button>
      </div>
    </form>
  );
}
