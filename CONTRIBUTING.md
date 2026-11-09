# Contributing

Thank you for helping improve SkillForge.

1. **License agreement first.** SkillForge is dual-licensed (see [LICENSE](LICENSE)). Every contribution must be
   covered by the [Contributor License Agreement](CLA.md). Accept it in your pull request description; pull requests
   without it cannot be merged.
2. **Development.** Node.js 24 or later.
   ```bash
   npm ci
   npm run build
   npm run lint
   npm test                                         # unit tests of every package
   node --test --test-concurrency=2 tests/*.test.mjs # integration tests against a real server
   npx playwright install chromium && npx playwright test   # end-to-end tests of the web interface
   ```
   `dist/` folders are build output and are not committed. `npm run dev:server` and `npm run dev:web` run the server
   and the web interface from source.
3. **Every change comes with its test.** A behaviour change needs a test that fails without it. User-facing changes
   also update the in-app help (`packages/web/src/help/topics/`) and, where relevant, `docs/en/`.
4. **Releases** are built by CI on a version tag (`.github/workflows/release.yml`): the tag must match the version in
   `package.json`; the workflow runs the tests, builds the archives, the CLI package and the Windows installer with
   `node scripts/release.mjs`, and attaches them with `SHA256SUMS.txt` to the GitHub release. The release notes are
   the version's section of [CHANGELOG.md](CHANGELOG.md): add it before you tag.
5. **Notices.** Keep the `Required Notice:` lines in the license files. Third-party material keeps its own license
   and is listed in [NOTICE.md](NOTICE.md).

## Installing another interface language locally

The web interface and the in-app help discover their languages at build time; English is the source and the
fallback.

1. Copy `packages/web/src/i18n/en.ts` and the `packages/web/src/i18n/en/` folder to `xx.ts` and `xx/`, where `xx`
   is the language code, and export the dictionary as `xx` of type `Messages`. Set `meta.nativeName` and
   `meta.locale` (for example `de-DE`).
2. Translate the values. Keep the keys, `{placeholders}`, command names, codes and test ids as they are.
3. Optionally translate help topics into `packages/web/src/help/topics-xx/` with the same ids as
   `packages/web/src/help/topics/`, and add `packages/web/src/help/topics-xx.ts` exporting `topics` (copy the shape
   of an existing translated module). The help assistant then answers in that language too.
4. Optionally add `plugins/review-assistant/locales/xx.json` for the review badge labels.
5. Keep the new files untracked; build with `npm run build`. A second language shows the language switcher in the
   header; with English only it stays hidden.
