import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAuthProviders, ldapLogin, login } from "../api/client.ts";
import type { AuthProviderInfo } from "../api/types.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { Button } from "../components/Button.tsx";

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.startsWith("/\\")) return "/";
  if (raw.includes("://")) return "/";
  return raw;
}

const SSO_ERROR_CODES = [
  "sso_state",
  "sso_denied",
  "sso_token",
  "sso_invalid_token",
  "sso_account_disabled",
  "sso_provider",
] as const;

/** Message for an SSO error code from the callback URL (read at call time: follows the interface language). */
function ssoErrorMessage(code: string | null): string | null {
  const known = SSO_ERROR_CODES.find((c) => c === code);
  return known ? STR.login[known] : null;
}

function isDisabledError(err: ApiError): boolean {
  return (
    err.error === "account_disabled" ||
    err.error === "disabled" ||
    err.status === 403 ||
    err.status === 423
  );
}

/** Message for a failed sign-in; null means the server is in local mode (go home instead). */
function loginErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return STR.login.invalid;
  if (err.error === "invalid_credentials" || err.status === 401) return STR.login.invalid;
  if (isDisabledError(err)) return STR.login.disabled;
  if (err.error === "ldap_unavailable" || err.status === 503) return STR.login.ldapUnavailable;
  if (err.error === "rate_limited" || err.status === 429) return STR.login.rateLimited;
  if (err.error === "local_mode" || err.status === 409) return null;
  return STR.login.invalid;
}

type LoginMethod = "password" | { ldap: string };

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<LoginMethod>("password");
  const next = safeNext(params.get("next"));

  const providersQuery = useQuery({
    queryKey: ["auth-providers"],
    queryFn: getAuthProviders,
  });

  useEffect(() => {
    document.title = STR.login.title + STR.ui.titleSuffix;
  }, []);

  useEffect(() => {
    const message = ssoErrorMessage(params.get("error"));
    if (message) {
      setError(message);
    }
  }, [params]);

  useEffect(() => {
    if (providersQuery.data?.mode === "local") {
      navigate("/", { replace: true });
    }
  }, [providersQuery.data, navigate]);

  const allProviders = providersQuery.data?.providers ?? [];
  const ldapProviders = allProviders.filter(
    (p): p is AuthProviderInfo & { type: "ldap" } => p.type === "ldap",
  );
  const oidcProviders = allProviders.filter((p) => p.type === "oidc");
  const showMethodSwitcher = ldapProviders.length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (method !== "password" && "ldap" in method) {
        await ldapLogin(method.ldap, username, password);
      } else {
        await login(username, password);
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate(next);
    } catch (err) {
      const message = loginErrorMessage(err);
      if (message === null) navigate("/", { replace: true });
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <PageHeader title={STR.login.title} description={STR.login.subtitle} topic="pages/login" />
      {showMethodSwitcher ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={STR.ui.login.method}>
          <HelpTip action="login-method">
            <button
              type="button"
              data-testid="login-method-password"
              role="tab"
              aria-selected={method === "password"}
              className={`rounded-sf border px-3 py-1.5 text-sm ${
                method === "password"
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-surface text-ink hover:bg-surface-2"
              }`}
              onClick={() => {
                setMethod("password");
                setError(null);
              }}
            >
              {STR.login.methodPassword}
            </button>
          </HelpTip>
          {ldapProviders.map((p) => {
            const selected = method !== "password" && method.ldap === p.id;
            return (
              <HelpTip key={p.id} action="login-method">
                <button
                  type="button"
                  data-testid={`login-method-${p.id}`}
                  translate="no"
                  role="tab"
                  aria-selected={selected}
                  className={`rounded-sf border px-3 py-1.5 text-sm ${
                    selected
                      ? "border-accent bg-accent text-white"
                      : "border-line bg-surface text-ink hover:bg-surface-2"
                  }`}
                  onClick={() => {
                    setMethod({ ldap: p.id });
                    setError(null);
                  }}
                >
                  {p.label}
                </button>
              </HelpTip>
            );
          })}
        </div>
      ) : null}
      <form
        className="space-y-4 rounded-sf border border-line bg-surface p-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <label className="block text-sm">
          <span className="text-muted">{STR.login.username}</span>
          <HelpTip action="login-username">
            <input
              data-testid="login-username"
              autoComplete="username"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </HelpTip>
        </label>
        <label className="block text-sm">
          <span className="text-muted">{STR.login.password}</span>
          <HelpTip action="login-password">
            <input
              data-testid="login-password"
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </HelpTip>
        </label>
        {error ? (
          <div
            data-testid="login-error"
            className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
          >
            {error}
          </div>
        ) : null}
        <HelpTip action="login-submit">
          <Button
            type="submit"
            data-testid="login-submit"
            pending={submitting}
            className="w-full rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {submitting ? STR.login.submitting : STR.login.submit}
          </Button>
        </HelpTip>
      </form>
      {oidcProviders.length > 0 ? (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted">{STR.login.orSso}</p>
          {oidcProviders.map((p) => (
            <HelpTip key={p.id} action="login-sso">
              <a
                data-testid={`login-sso-${p.id}`}
                href={`/api/v1/auth/oidc/${encodeURIComponent(p.id)}/start?next=${encodeURIComponent(next)}`}
                className="flex w-full items-center justify-center rounded-sf border border-line bg-surface px-4 py-2 text-sm font-medium text-ink no-underline hover:bg-surface-2"
              >
                {STR.login.ssoWith} <span translate="no">{p.label}</span>
              </a>
            </HelpTip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
