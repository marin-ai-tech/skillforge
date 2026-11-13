---
title: E_SECRET_FILE
summary: Blocking error: a file looks like a secret by its name (.env, a private key, credentials), so the version cannot be published — the registry would hand the file to everyone who installs the artifact.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: the name of a file says it holds a secret. Severity label: **Blocking**. The registry checks names on every path — publishing, import, mirrors and tracked sources — and the CLI and the Publish page check them before anything is sent, so the file never leaves your machine. Issue codes are stable across API, UI, and import.

## Common causes

These names are refused, at any level of the folder and in any case:

- `.env` and `.env.*`; templates `.env.example`, `.env.sample`, `.env.template` and `.env.dist` are allowed;
- private keys and key stores: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` (a public `id_rsa.pub` is allowed);
- credentials: `credentials*.json`, `.credentials.json`, `auth.json`, `*.local.json`, `.netrc`, `.npmrc`, `.git-credentials`.

A secret inside an ordinary file (a key pasted into `SKILL.md`) is the security scan's job, not this check.

## How to fix

Remove the file from the folder, or keep an example without real values under a template name. If the artifact needs a key, describe in `SKILL.md` where people put their own. Re-run validation on the Publish page and confirm the issue disappears from the issue list.

```
mv .env .env.example   # keep the variable names, remove the values
rm certs/server.key
```
