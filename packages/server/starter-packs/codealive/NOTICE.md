# NOTICE

This starter pack vendors third-party skills under the MIT License.

## Source repositories

- CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82
- CodeAlive-AI/pragmatic-orchestration @b349fd32607998f487d40935d2303b07ee1f9b52

## Skills

- settings-management: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/settings-management
- hooks-management: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/hooks-management
- skills-management: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/skills-management
- prompt-engineering: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/prompt-engineering
- code-that-fits-in-your-head: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/code-that-fits-in-your-head
- bug-fix-protocol: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/bug-fix-protocol
- plan-mode: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/plan-mode
- investigating-repository-history: CodeAlive-AI/ai-driven-development @af4035b657a54c9a6ff7deb85af070f494892d82 path skills/investigating-repository-history
- pragmatic-orchestration: CodeAlive-AI/pragmatic-orchestration @b349fd32607998f487d40935d2303b07ee1f9b52 path skills/pragmatic-orchestration

## Local changes

Differences from the source repositories, so that a client that accepts only text can load the skills:

- pragmatic-orchestration: removed assets/pragmatic-orchestration-cover.png and its image line in README.md
- pragmatic-orchestration: removed ui/public/brand/porch-mark.png (the optional desktop UI shows no icon)
- pragmatic-orchestration: English-only text — the non-English correction markers in scripts/lib/analyze.py and the non-English examples in references/session-history.md and references/ui.md are removed; non-ASCII test strings in scripts/tests/ui_test.py, scripts/tests/steer/test_orchestration.py and ui/tests/desktop.mjs use other characters of the same width
