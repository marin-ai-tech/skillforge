---
title: Interface language
summary: Switches the interface language without reloading the page, when more than one language is installed. Use it when your browser language is not the one you want to read.
related: actions/navigation/theme-toggle
---

## What it does

Switches the interface language without reloading the page. The switch is shown only when the installation has more than one interface language; English is always there. The first time you open SkillForge the language follows your browser (a browser language that is installed opens that interface, any other the English one); after you pick a language, the choice is kept in this browser (localStorage key `skillforge.lang`) and the page `lang` attribute follows it.

## When to use

Use it when the browser language is not the one you want to read. Artifact content (names, descriptions, files) and commands are shown as their authors wrote them and are not translated. Some product terms stay in English in every interface language on purpose — lifecycle statuses and roles (`candidate`, `active`, `reviewer`…), digest, provenance, evidence, Transfer Rate — because they match the API, the CLI and the documentation.

## Requires

No sign-in. Help topics follow the interface language too; a topic that is not translated yet is shown in English with a note above it.
