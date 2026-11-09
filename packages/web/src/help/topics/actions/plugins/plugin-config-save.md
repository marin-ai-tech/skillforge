---
title: Save plugin config
summary: Saves a plugin's JSON configuration; valid values apply immediately. Use it to change the settings of a server-side plugin from the Plugins page.
related: pages/admin-plugins, getting-started/plugins
---

## What it does

Parses the JSON editor and PATCHes the plugin config. On success the new values apply immediately; invalid shapes return config_invalid.

## When to use

Use this control when administering server-side plugins on a self-hosted SkillForge instance and you need the corresponding admin workflow described above.

## Requires

Role admin. Anonymous users are sent to sign-in; non-admin signed-in users see admin-forbidden on the Plugins page.
