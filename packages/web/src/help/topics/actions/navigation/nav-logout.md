---
title: Sign out
summary: Signs you out and clears your session cookie. Use it when leaving a shared machine or switching accounts.
related: pages/login
---

## What it does

Calls POST /api/v1/auth/logout, clears the sf_session cookie, and returns you to an unauthenticated state. The button sits next to your username in the header and at the end of the user menu, takes you to Home afterwards, and is hidden in Local mode, where there is no session to end.

## When to use

Use when leaving a shared machine or switching accounts.

## Requires

Requires sign-in.
