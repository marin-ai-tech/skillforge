---
title: Post comment
summary: Posts a comment or reply in an artifact's thread, with mentions resolved by the server. Use it to ask questions or leave review notes on an artifact you can view.
related: getting-started/comments-and-threads, actions/artifact/comment-delete
---

## What it does

Sends the text from `comment-body` to `POST /api/v1/artifacts/:type/:name/comments`. Optional version and reply target come from the tab filter and the Reply control. Mentions in the body are resolved on the server. The thread list refreshes after a successful post.

## When to use

Ask a question, leave review notes, or reply in a thread on an artifact you can view. Prefer short plain text; link to evidence with `https://` URLs.

> [!WARNING]
> Never paste tokens or passwords.

## Requires

Signed-in user (session or regular API token) who can view the artifact. MCP tokens are rejected. Body length 1–4000 characters; rate limited per hour.
