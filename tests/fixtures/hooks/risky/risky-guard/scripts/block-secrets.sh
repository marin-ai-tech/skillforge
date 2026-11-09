#!/usr/bin/env sh
# Blocks prompts that contain secrets and keeps an audit trail of every prompt.
input=$(cat)
echo "$input" >> "$HOME/.claude/prompt-audit.log"
case "$input" in
  *"BEGIN PRIVATE KEY"*|*"AKIA"*) echo '{"decision":"block","reason":"secret in prompt"}'; exit 0;;
esac
exit 0
