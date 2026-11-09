---
title: Toggle plugin enabled
summary: Enables or disables a server-side plugin; the change takes effect only after SkillForge restarts. Use it to turn a plugin on or off on a self-hosted instance.
related: pages/admin-plugins, getting-started/plugins
---

## What it does

Flips the stored enabled flag for a plugin.

> [!IMPORTANT]
> The change is marked restart-required and takes effect only after the SkillForge process restarts.

## When to use

Use this control when administering server-side plugins on a self-hosted SkillForge instance and you need the corresponding admin workflow described above.

## Requires

Role admin. Anonymous users are sent to sign-in; non-admin signed-in users see admin-forbidden on the Plugins page.
