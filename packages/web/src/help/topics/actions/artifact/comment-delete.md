---
title: Delete comment
summary: Deletes a comment after confirmation, leaving a stub so replies stay visible. Use it to remove your own mistaken comment or, as a reviewer or admin, abusive content.
related: getting-started/comments-and-threads, actions/artifact/comment-submit
---

## What it does

Opens a `ConfirmDialog`, then calls `DELETE /api/v1/comments/:id`. The server soft-deletes: body cleared, `deleted` stub remains, nested replies stay visible. Moderator deletes are written to the artifact audit log.

## When to use

Remove your own mistaken comment, or as reviewer/admin remove abusive content. Prefer edit when you only need to fix a typo.

## Requires

Author of the comment, or role reviewer/admin. Signed-in with a non-MCP token. Already-deleted comments return not found.
