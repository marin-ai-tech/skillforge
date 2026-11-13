# NOTICE

This starter pack vendors third-party skills under the MIT License.

## Source repositories

- CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01
- CodeAlive-AI/pragmatic-orchestration @595a7719bdef12480eb775fb50978f19f0c475be

## Skills

- settings-management: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/settings-management
- hooks-management: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/hooks-management
- skills-management: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/skills-management
- prompt-engineering: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/prompt-engineering
- code-that-fits-in-your-head: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/code-that-fits-in-your-head
- bug-fix-protocol: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/bug-fix-protocol
- plan-mode: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/plan-mode
- investigating-repository-history: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/investigating-repository-history
- ubiquitous-language: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/ubiquitous-language
- ux-best-practices: CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01 path skills/ux-best-practices
- pragmatic-orchestration: CodeAlive-AI/pragmatic-orchestration @595a7719bdef12480eb775fb50978f19f0c475be path skills/pragmatic-orchestration
- coordinator-mode: CodeAlive-AI/pragmatic-orchestration @595a7719bdef12480eb775fb50978f19f0c475be path skills/coordinator-mode

## Local changes

Differences from the source repositories, so that a client that accepts only text can load the skills:

- pragmatic-orchestration: removed assets/pragmatic-orchestration-cover.png and its image line in README.md
- pragmatic-orchestration: removed ui/public/brand/porch-mark.png (the optional desktop UI shows no icon)
- pragmatic-orchestration: English-only text — the non-English correction markers in scripts/lib/analyze.py and the non-English examples in references/session-history.md and references/ui.md are removed; non-ASCII test strings in scripts/tests/ui_test.py, scripts/tests/review_input_test.py, scripts/tests/steer/test_orchestration.py and ui/tests/desktop.mjs use other characters of the same width
- coordinator-mode: English-only text — the non-English trigger phrase is removed from the description in SKILL.md
- ubiquitous-language: English-only text — the non-English example term in SKILL.md and README.md is replaced with the German "Rechnung" (same role in the example)
