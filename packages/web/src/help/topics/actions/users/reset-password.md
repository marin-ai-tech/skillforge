---
title: Reset user password
summary: Lets an admin set a new password on another user's account. Use it when a user is locked out and cannot change the password themselves.
related: pages/users
---

## What it does

Admin sets a new password (at least 8 characters) on another account via PATCH /api/v1/admin/users/:id.

## When to use

Use when a user is locked out and cannot use the self-service Changing your password page.

## Requires

Requires sign-in as admin.
