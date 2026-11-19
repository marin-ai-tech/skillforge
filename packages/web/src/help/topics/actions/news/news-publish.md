---
title: Publish a post or save a draft
summary: Sends the post form to the server, either to publish the post or to keep it as a draft. Errors are shown at the fields and in a summary, and the focus moves to the first invalid field.
related: pages/news, actions/news/news-new
---

## What it does

**Publish** creates the post for the chosen audience; with a publication time in the future it appears in the feed at that time. **Save draft** keeps it out of the feed until you publish it. The title is required (up to 200 characters), the text is limited to 20,000 characters, and the end of display must be later than the publication time.

## When to use

Publish when the text is final; save a draft when it still needs a review or a date.

## Requires

The `admin` role or the lead role in the chosen team; the server checks the audience on every request and rejects another team with an error.
