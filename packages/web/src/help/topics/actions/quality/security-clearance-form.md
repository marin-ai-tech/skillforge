---
title: Mark findings as false positives
summary: Records a Security Clearance for a failed security scan, with a reason that everyone can see. Use it when the findings are false positives and the version should be allowed through the gates.
related: actions/quality/tab-quality, actions/quality/security-clearance-remove, getting-started/quality
---

## What it does

Sends the reviewer's reason to the server and stores a Security Clearance next to the version's security report. The verdict stays `fail`. While the mark is current, the version can become active, be assigned to a team and enter a pack, and install no longer needs `--allow-risky`.

## When to use

Use it on the Quality tab when the security verdict is `fail` and you have reviewed the findings and can explain why they are false positives. The form is shown to a reviewer or admin who is not the publisher of the version (an admin who published it may still mark it).

## Requires

Reviewer or admin, and you must not be the publisher of the version unless you are an admin. A reason of 1 to 500 characters is required. The scan verdict must be `fail`, and there must not already be a current mark.
