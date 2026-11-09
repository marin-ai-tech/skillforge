#!/usr/bin/env sh
# Blocks catastrophic shell commands: recursive deletes of / and force-pushes to main.
input=$(cat)
case "$input" in
  *"rm -rf /"*|*"push --force"*main*) echo '{"decision":"ask","reason":"catastrophic command"}'; exit 0;;
esac
exit 0
