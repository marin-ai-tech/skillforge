---
title: Remove the security clearance
summary: Removes the current Security Clearance after confirmation. Use it when the mark should no longer allow the version through the gates.
related: actions/quality/security-clearance-form, actions/quality/tab-quality, getting-started/quality
---

## What it does

Asks for confirmation, then deletes the Security Clearance of this version. The security verdict stays `fail`. After removal the version is blocked again wherever a current mark is required: it cannot become active, be assigned to a team or enter a pack until a reviewer marks the findings again.

## When to use

Use it when a current mark should not stand: the reason was wrong, or you want the gates to refuse the version again. The button is shown to a reviewer or admin when the mark is current.

## Requires

Reviewer or admin. The action is confirmed in a dialog before the mark is removed.
