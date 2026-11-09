import { useEffect, useState, type FormEvent } from "react";
import { ApiError, changePassword } from "../../api/client.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { STR } from "../../lib/strings.ts";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { errorText } from "../../i18n/index.ts";

function PasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = STR.ws.password.docTitle;
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setError(null);
    if (next !== confirm) {
      setError(STR.password.mismatch);
      return;
    }
    if (next.length < 8) {
      setError(STR.password.tooShort);
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.error === "invalid_credentials") {
          setError(STR.password.incorrect);
        } else if (err.status === 400 || err.error === "bad_request") {
          setError(STR.password.tooShort);
        } else {
          setError(errorText(err));
        }
      } else {
        setError(STR.password.incorrect);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <PageHeader title={STR.password.title} topic="pages/password" />
      <form
        className="space-y-4 rounded-sf border border-line bg-surface p-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <label className="block text-sm">
          <span className="text-muted">{STR.password.current}</span>
          <HelpTip action="password-current">
            <input
              data-testid="password-current"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.password.next}</span>
          <HelpTip action="password-next">
            <input
              data-testid="password-next"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.password.confirm}</span>
          <HelpTip action="password-confirm">
            <input
              data-testid="password-confirm"
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </HelpTip>
        </label>
        {error ? (
          <div
            data-testid="password-error"
            className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
          >
            {error}
          </div>
        ) : null}
        {success ? (
          <div
            data-testid="password-success"
            className="rounded-sf bg-accent/10 px-2 py-1.5 text-sm text-accent"
          >
            {STR.password.success}
          </div>
        ) : null}
        <HelpTip action="password-submit">
          <button
            type="submit"
            data-testid="password-submit"
            disabled={submitting}
            className="w-full rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {submitting ? STR.password.submitting : STR.password.submit}
          </button>
        </HelpTip>
      </form>
    </div>
  );
}

export function Password() {
  return <RequireUser>{() => <PasswordPage />}</RequireUser>;
}
