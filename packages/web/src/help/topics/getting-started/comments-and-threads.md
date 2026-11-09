---
title: Comments and threads
summary: How to discuss an artifact next to its card with threads, mentions and moderation, and what is safe to post.
section: lifecycle
learn:
  - Who can post comments
  - How mentions and one-level replies work
  - How editing, soft delete and moderation work
  - Why comments must never contain secrets
related: getting-started/notifications-and-watch, pages/artifact, actions/artifact/comment-submit
---

SkillForge keeps discussion next to the artifact card. Open the **Comments** tab (`?tab=comments`) to read threads, reply, edit your own text, or soft-delete a comment. The same flows are available from the CLI (`skillforge comments` / `skillforge comment`).

## Who can write

Anyone who can **view** the artifact and is signed in with a normal session or API token may post. MCP tokens are rejected (`mcp_token_forbidden`). Anonymous visitors see the tab when the card is visible, but the compose form (`comment-body` / `comment-submit`) is hidden. Rate limits apply (about 30 comments per hour per user).

## Mentions and threads

Type `@username` to mention someone who can also see the artifact. Mentions are resolved only for existing, enabled users with visibility; the API returns the accepted list in `mentions`. Replies nest one level under a root comment (`--reply` / `parent_id`); answering a reply attaches to the root so the tree stays shallow. Optional `version` and `ref` (for example a finding id) help filter the thread later.

## Edit, delete, moderation

Authors may **edit** their own comments (`PATCH`) and **delete** them (soft delete: body cleared, stub remains, replies kept). Reviewers and admins may delete any comment; moderation deletes are audited as `comment_delete`. The UI always uses a `ConfirmDialog` for delete — never a bare `window.confirm`.

## Safety: text only, no secrets

Comment bodies are plain text up to 4000 characters. The web UI renders them as **escaped text** only (no HTML, no markdown rendering, no `dangerouslySetInnerHTML`). Newlines are preserved; `http://` and `https://` links open with `rel="noopener noreferrer"`.

> [!CAUTION]
> Do **not** paste secrets, tokens, or passwords into comments — treat the thread as shared registry text.