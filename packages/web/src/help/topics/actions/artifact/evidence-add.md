---
title: Add evidence
summary: Attaches an evidence record (a gate, run, diff, review, or eval link) to the selected version. Use it to back a version with verifiable proof, such as a passed quality gate.
related: getting-started/evidence-and-usage, actions/artifact/set-channel
---

## What it does

Attaches one evidence record — kind `gate`, `run`, `diff`, `review` or `eval`, a link and an optional summary — to the version selected in the Evidence tab. The server stamps your username and the current time. A `gate` record also sets the version's `validated_at`. The list and the usage panel refresh after the record is saved; adding the same kind and link again changes nothing.

## When to use

Add a `gate` link when the version passed its quality gate or eval suite, a `run` or `eval` link for a notable run, a `diff` for the change behind the version, and a `review` for a completed review. Links must be `https://`, `http://` or a registry path starting with `/`. Instead of a link you can pick a text file (`evidence-file`, UTF-8, up to 64 KiB), for example a local `verification.md`: it is stored in the registry and the record shows its name as a link to the text.

> [!WARNING]
> Do not paste secrets or tokens into the link or the summary.

## Requires

The owner or a maintainer of the artifact; reviewers and admins may add evidence as an audited override. Signed in with a session or a regular API token (MCP tokens are rejected). At most 100 records per version; retired artifacts accept none.
