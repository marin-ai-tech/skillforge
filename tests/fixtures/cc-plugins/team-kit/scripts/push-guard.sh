#!/usr/bin/env sh
# Asks before force-pushing a release tag.
input=$(cat)
case "$input" in
  *"push --force"*) echo '{"decision":"ask","reason":"force push during release"}'; exit 0;;
esac
exit 0
