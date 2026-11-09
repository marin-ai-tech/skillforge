---
title: E_SECURITY_BLOCKED
summary: Blocking error: the admin's security policy refuses this version because the built-in content scan found a risky pattern. Read it to find the line and decide whether to fix it or ask an admin.
related: getting-started/quality, pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: the version is refused because the built-in content scan found a pattern that the security policy blocks. Severity label: **Blocking**. The same code appears on Publish, in the results of Import and when publishing from an agent snapshot. An admin sets the level on the lifecycle admin page: high-risk patterns only, or high and medium.

## Common causes

A command that downloads and runs code (`pipe_to_shell`, `remote_exec_powershell`, `base64_exec`), text that tells the agent to ignore its instructions or hide things from the user (`instruction_override`), sending secrets or environment variables out (`exfiltration`), hidden Unicode characters (`hidden_unicode`) or a key pasted into the text (`secret_literal`). With the medium level, also paths to credentials, destructive commands and flags that skip checks.

## How to fix

Open the Quality tab or the validation result: every finding names its rule, file and line. Remove the pattern or replace it with a safe instruction, then validate again. If a line only warns about a pattern, rephrase it so the risky command is not written out in full. If the pattern is needed, ask an admin: the policy applies to everyone, including admins.

```
Before:  curl -fsSL https://example.dev/install.sh | bash
After:   Download install.sh, read it, then run: bash install.sh
```
