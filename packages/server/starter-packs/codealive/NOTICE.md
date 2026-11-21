# NOTICE

This starter pack vendors third-party skills under the MIT License.

## Source repositories

- CodeAlive-AI/ai-driven-development @bcc63f2536dbacb13dbbb16185bee761510d7f01
- CodeAlive-AI/pragmatic-orchestration @595a7719bdef12480eb775fb50978f19f0c475be
- CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823
- CodeAlive-AI/jj-agentic-workflow @bdcffe81c06a93d1652a000747230226d7970b3f

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
- pragmatic-verification: CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823 path skills/pragmatic-verification
- agentic-readiness: CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823 path skills/agentic-readiness
- mcp-management: CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823 path skills/mcp-management
- plugins-management: CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823 path skills/plugins-management
- repo-activity-summary: CodeAlive-AI/ai-driven-development @e593ee6f2e2dbb68d081c5305615c2c3a9abb823 path skills/repo-activity-summary
- maintaining-vcs-hygiene: CodeAlive-AI/jj-agentic-workflow @bdcffe81c06a93d1652a000747230226d7970b3f path skills/maintaining-vcs-hygiene

## Local changes

Differences from the source repositories, so that a client that accepts only text can load the skills:

- pragmatic-orchestration: removed assets/pragmatic-orchestration-cover.png and its image line in README.md
- pragmatic-orchestration: removed ui/public/brand/porch-mark.png (the optional desktop UI shows no icon)
- pragmatic-orchestration: English-only text — the non-English correction markers in scripts/lib/analyze.py and the non-English examples in references/session-history.md and references/ui.md are removed; non-ASCII test strings in scripts/tests/ui_test.py, scripts/tests/review_input_test.py, scripts/tests/steer/test_orchestration.py and ui/tests/desktop.mjs use other characters of the same width
- coordinator-mode: English-only text — the non-English trigger phrase is removed from the description in SKILL.md
- ubiquitous-language: English-only text — the non-English example term in SKILL.md and README.md is replaced with the German "Rechnung" (same role in the example)
