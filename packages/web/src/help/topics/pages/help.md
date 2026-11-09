---
title: Help center
summary: The Help center is the searchable index of every help topic. Use it when you do not know which page help to open or when you follow a link from a validation code.
section: ui-other
learn:
  - How to search help topics by keyword or issue code
  - How topics are grouped and linked
  - How the Help center relates to the page help panel
  - Who may read help
related: getting-started/overview, shortcuts/keyboard
---

## What this page is for

The Help center at `/help` is a searchable index of every markdown topic under `packages/web/src/help/topics`. Use it when you do not know which page panel to open, when you need getting-started conceptual articles, or when you follow a deep link from a validation issue code. Search matches titles and body text. The navigation on the left is a tree of sections: seven guide sections (Getting started, Publishing and versions, Lifecycle and review, Evidence, Teams and access, Automation, Operations), then Interface pages, Actions grouped by screen, and Validation codes grouped into errors, warnings and quality checks. Only the section of the open topic is expanded; the others show a topic count. The same content powers the slide-over Help panel opened with `?` on each page. Topic quality is enforced by the help content standard (word minima and required sections).

## What you see

- Search input to filter topics by keyword (names, issue codes, UI control labels).
- A collapsible section tree with icons and topic counts; the open topic is highlighted.
- Each topic starts with why it exists and what you will learn, then the text with colour callouts (Note, Tip, Important, Warning, Caution), related topics as cards and Previous / Next links inside the section.
- On wide screens, an On this page list of the topic's sections on the right.
- When the administrator has turned the help assistant on, an Assistant tab next to Help topics opens a read-only chat that answers questions from this help.
- Entry points into Getting started (overview, artifact types, lifecycle, roles, versions, provenance).
- Links toward page topics (Home, Catalog, Publish, and others) and keyboard shortcuts.
- Shared navigation chrome and theme toggle; empty filter state when no topic matches the query.

## Common tasks

1. Open `/help` from navigation or after pressing `?` and choosing a broader article.
2. Search for an issue code such as `E_NAME_INVALID` or a word like `digest`.
3. Open Getting started lifecycle before a review pass on candidate artifacts.
4. Open a page topic to learn Common tasks for Catalog or Publish.
5. Follow related links in frontmatter to move between conceptual and procedural help.
6. Press Escape to close the help panel if you opened the overlay instead of the full page.

## Permissions

Help content is available to anyone who can load the SPA (no sign-in required for reading topics). Actions described inside topics may still require roles: publish needs contributor+, user admin needs admin, and so on. Help never elevates privileges; it only documents them.
