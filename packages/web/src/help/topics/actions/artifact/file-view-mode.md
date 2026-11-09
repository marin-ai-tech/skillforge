---
title: Rendered and Source view of a markdown file
summary: Switches a markdown file on the Files tab between Rendered view and Source view. Use Source when you need the exact characters of a version, such as frontmatter or markup that does not render.
related: pages/artifact
---

## What it does

On the Files tab, a markdown file (`.md`) opens in **Rendered** view: the body is formatted as text with headings, lists, links and code blocks, and the frontmatter (the `---` block at the top, such as `name` and `description` of a skill) is shown as a key — value table above it. **Source** shows the file exactly as published, as code. Other text files are always shown as code.

## When to use

Read a skill, command or agent in Rendered view. Switch to Source when you review a version and need the exact characters: frontmatter values with nested blocks, spacing, or markup that does not render.

## Requires

Any visitor who can see the artifact. The switch appears only for `.md` files on the Files tab.

## Details

- The choice is kept in the page address (`view=source`), so a link opens the same view; without it the file opens rendered.
- Rendering is safe: embedded HTML is not executed, and links with scripts (`javascript:`) do not work.
- If the frontmatter cannot be read as simple `key: value` lines, the file is shown as source with a short note.
