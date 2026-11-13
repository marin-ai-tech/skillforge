---
title: Save the branch or tag
summary: Pins the tracked source of this artifact to a branch or tag, or returns it to the default branch. Use a tag to take only releases.
related: getting-started/tracked-sources, pages/artifact
---

## What it does

Saves `ref` on the tracked source (`PUT …/source`). The next check takes the commit of this branch or tag; an empty field saves `null` and follows the default branch of the repository. Letters, digits, dot, underscore, slash and hyphen are allowed, up to 200 characters and without `..` segments.

## When to use

Pin a release tag when the default branch moves too fast, or a maintenance branch when the main one changed direction. Clear the field to follow the default branch again.

## Requires

The owner, a maintainer or an admin. The address and the folder of the source cannot be changed.
