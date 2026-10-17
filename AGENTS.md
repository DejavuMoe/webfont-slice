# AGENTS.md — Rules for Coding Agents

> Canonical instruction file for every coding agent (Claude Code, Codex, Pi Coding Agent, and others). `CLAUDE.md` is a compatibility shim that imports this file; if the two ever diverge, this file wins.
>
> WebFont Slice is a static, browser-only tool that splits web fonts into on-demand WOFF2 shards. Before changing code, read `README.md` (scope and non-goals), `docs/ARCHITECTURE.md` (how the code actually runs), `docs/SHARDING.md` (planner, size model, benchmarks), and `TODO.md` (status and verification baseline). Where prose and code disagree, code and tests win — fix the prose before continuing.
>
> Change the docs in the same commit as the code they describe: `docs/ARCHITECTURE.md` for layers, state, UI or Worker behaviour; `docs/SHARDING.md` for the planner, size model or benchmarks; `docs/DATA.md` for character sets and frequency data; `docs/DEPLOYMENT.md` for the ZIP layout or deploy steps; `CHANGELOG.md` for anything a user would notice. This file wins on rules; code and tests win on facts.

## 1. Hard rules

1. **Nothing leaves the device.** No backend, upload, telemetry, remote logging, or third-party analytics for fonts, user text, or results.
2. **No SharedArrayBuffer, no COOP/COEP.** Keep `base: './'` so the build runs on any static host.
3. **`src/core` is pure TypeScript.** It may not import React, DOM or Worker globals, `File`, `fetch`, `import.meta`, WASM, or any third-party package — including in type positions.
4. **Node.js 24+ and pnpm 11.24+.** No npm or yarn. Dependency changes ship with `pnpm-lock.yaml`.
5. **Trust signatures, not extensions or MIME types.** All Unicode work uses scalar code points, never UTF-16 code units.
6. **Pinned dependency versions are security-relevant.** `fflate@0.8.3`, `wawoff2@2.0.1` and `hb-subset-wasm@0.4.0` are pinned to the decompression budgets audited in `src/engine/font-budget.ts`. Upgrading any of them requires re-auditing the bounds and re-running the benchmarks.
7. **Do not write Git history or remotes without an explicit request** in the current conversation — no `git add`, `commit`, `tag`, `push`, or rebase. Read-only `git status` and `git diff` are always fine.
8. **Numbers shown in the UI must be computed.** Estimates are labelled as estimates; measured values come from the generated result. Never let a passing test paper over a broken invariant, and never mark a task done without test evidence.

## 2. Layers and dependency direction

```text
src/core/      Pure domain: code point sets, frequency model, shard planner, export plan, CSS/report/ZIP text
src/app/       Application: store, state and persistence, derived selectors, AppController, port interfaces
src/engine/    Worker/WASM: inspection, size calibration, HarfBuzz subsetting, WOFF/WOFF2, thread pool
src/platform/  Browser adapters: charset/frequency fetch, ZIP worker, download/clipboard/directory, FontFace, Service Worker
src/ui/        React views; state changes go through AppController only
src/i18n/      Locale and theme preferences
src/App.tsx    The only composition root: builds EnginePool, repositories and platform actions, then injects them
```

```text
ui       → app, core, i18n
app      → core (no third-party packages at all, React included)
engine   → core, app/ports, generated
platform → core, app/ports
i18n     → core
core     → core, data/unicode-blocks.json
```

- `architecture/source-layers` in `eslint.config.js` enforces this by resolving real paths, including deep relatives, `@/` aliases, dynamic imports, `import type`, `require`, and triple-slash references. `architecture/no-platform-globals` rejects browser and Worker globals in `core`, value and type positions alike. `pnpm core:typecheck` is the second gate: it typechecks `core` with no DOM, Worker, or Vite ambient types.
- `pnpm architecture:verify` proves the rules themselves still work, using 42 probes that must be rejected and 10 that must be allowed.
- `engine` and `platform` implement only the interfaces in `src/app/ports.ts` (`FontEngine`, `SubsetSession`, `CharsetRepository`). They must never reach back into other `app` modules or into `ui`.
- `ui` never constructs Workers, engines, or reusable platform implementations. Capabilities arrive through `AppServices` (`src/ui/app-context.tsx`). A `FontFace` or object-URL effect tied to one component's lifecycle, with complete cleanup, may stay in `ui`.
- Do not route around the layers with deep relative paths, aliases, dynamic imports, ambient types, or data bridges.

## 3. State invariants

`AppState` (`src/app/state.ts`) is the single source of truth and `AppController` is its only writer.

- Font entries move `queued → inspecting → ready | error`. At most 3 inspections run concurrently; idle engine threads are reclaimed after 8 s.
- The character target is `requested = level presets(language) ∪ extras ∪ library ∪ custom text ∪ U+ ranges`. Each face then derives `available = requested ∩ cmap` and `missing`. The `all` level uses the cmap directly; `text` uses only custom input. When language is `auto`, `selectLanguageDetection` decides — the controller must not override it.
- Whole kana or hangul blocks are added automatically only when the font actually provides those glyphs; otherwise only the characters present in the text are kept.
- When the first ready font has no meaningful Han, kana, or hangul coverage (`classifyFontScript` in `core/font-script.ts`), it is treated as a Western font: no language selector, no Han presets, no extras. The `common` and `full` levels become Western/Multilingual and take the font's own characters by Unicode block (`CharacterTarget.fontRanges`); characters the font lacks are not counted as missing. `all` is the recommended default.
- Frequency data affects ordering and size estimates only. It never changes the target set.
- Faces with identical available-character sets share one shard split and each estimate sizes with its own cost model.
- Generation is blocked whenever `selectBlockers` or `ExportPlan.issues` is non-empty. Never silently skip a failing font — the user must remove it.
- At most one run at a time. Cancellation propagates through `AbortSignal` and terminates the pool, re-queueing in-flight inspections. Every `await` must be followed by a `signal` check (`throwIfAborted`); late results must never write back.
- Results carry an `inputKey`. Changing fonts, characters, sharding, or output settings that affect shard bytes marks the result stale. Settings that only affect CSS text — URL prefix, `font-display` — are excluded from `inputKey`; `resultPackage` rebuilds the text immediately instead.
- Settings persist to `localStorage['webfont-slice:settings:v3']` and are strictly validated on read. **Custom text is never persisted.**
- Every produced shard is loaded through `FontFace` (the browser's OTS) before it is accepted. A failure aborts the run rather than emitting a broken file.
- File names, family names, URL prefixes, and font metadata are all untrusted input. Escape CSS strings, CSS comments, URLs, HTML text and attributes, and embedded JSON per context. The packager rejects duplicate file names.

## 4. Sharding and output

- The planner lives in `src/core/shard-planner.ts`; `docs/SHARDING.md` documents the model and its parameters. After changing the objective function, the granularity table, or the size model, run `pnpm benchmark:planner <full CJK font> --measure` and update the results in `docs/SHARDING.md`.
- Code points inside a shard are emitted in ascending order. Frequency-ranked characters are split in descending probability; the unranked tail is packed in code point order so `unicode-range` compresses into few contiguous runs. When packing crosses into another script group (`scriptFamily`: Latin, Greek, Cyrillic, symbols, CJK, hangul, private-use icons, …), cut as soon as the current shard is at least `max(2 × overhead, minBytes / 4)`.
- Extra layout features retained during subsetting live in `core/layout-features.ts`, shared by engine and UI. Do not add `dlig`, `aalt`, or `salt` — they pull glyphs in through GSUB closure and inflate CJK base shards (Noto Sans SC's `dlig` takes the base shard from 14 KB to 28 KB). Any new feature needs a full-CJK benchmark proving the base shard did not grow.
- Base characters (ASCII plus common CJK and Western punctuation) form their own shard and are recommended for preload. At most 3 files are preloaded.
- There are exactly two sharding strategies: on-demand shards (7 granularity levels) and a single file. Do not reintroduce count-based or size-based splitting, file name templates, or hash toggles; propose them in the README first if you need them.
- File names are `<prefix>-<variant>-<index>.<hash>.woff2`, generated by `core/naming.ts`. `prefix` is `FaceDraft.filePrefix`, falling back to the family slug.
- Only the uploaded font is sliced. The CSS emits no fallback `@font-face`, no `local()`, and no metric overrides, and `font-family` gets no generic family. The fallback stack is the user's business — do not add it back.
- The "vs. single file" baseline is `estimateSingleFileBytes` — the estimate for the same character set in one file — not the sum of shard sizes.
- Ranges have exactly one representation: ascending, non-overlapping `readonly [start, endInclusive][]`. Validation, compression, expansion, and CSS formatting all live in `core/range-codec.ts`.
- The ZIP layout is fixed: `fonts.css`, `preload.html`, `demo.html`, `report.json` (`webfont-slice/report@4`), `README.md`, and `fonts/*.woff2`. Changing it or the schema requires updating the e2e suite, `docs/DEPLOYMENT.md`, and `CHANGELOG.md`.

## 5. Engine pipeline

```text
File → signature + 100 MB + TTC checks
     → WOFF2 / WOFF1 unpacked to SFNT within budget (100 MB hard cap on the normalized result)
     → opentype.js plus raw tables: cmap, names, metrics, axes and instances, per-glyph raw bytes
     → size model calibrated by real subsetting
     → EnginePool: thread count from memory budget and core count, one font load per thread
     → HarfBuzz subsetting (web layout features, optional hinting, trimmed name table) → WOFF2
     → FontFace validation → content-hashed file name → CSS / preload / demo / report → ZIP worker
```

- HarfBuzz and wawoff2 WASM stay as separate static assets (`assetsInlineLimit: 0` plus `?url`). `src/generated/` is produced by `pnpm prepare:wawoff2`; never hand-edit it and never commit it.
- ArrayBuffers cross Worker boundaries by transfer. A transferred buffer must never be read again.
- Thread count comes from `core/threads.ts`: at most 6 and never more than cores − 1, budgeted at roughly 24 MB + 3.2 × font size per thread, because the HarfBuzz heap only grows.
- WOFF1 validates the full directory, the 100 MB target, at most 4095 tables, and a 1032× declared expansion per table before touching zlib. It inflates in chunks and stops the moment a declaration is exceeded.
- WOFF2 accounts for its intermediate state from the directory: 100 MB, at most 100× the container, at most 4095 tables, strict transform versions. The private copy handed to the decoder has `totalSfntSize` zeroed, because that field is advisory for transformed `glyf` yet the binding preallocates from it.
- Engine errors are written in Chinese and mapped to English by `localizeEngineError` in `src/ui/messages.ts`. Change a message and you change its mapping and its test.

## 6. UI copy and design system

Copy:

1. State outcomes, not implementation. No "worker", "session", "pre-check", or "calibration coefficient" in the interface.
2. Microcopy is a phrase without a full stop. Say each fact once — "fonts are never uploaded" appears only in the header privacy badge.
3. No exclamation marks, no "easy/powerful/perfect/one-click/blazing", no checkmark feature lists, no invented sample numbers. Where real data exists, show real data.
4. Locked terminology: shard / base shard / face / preset / missing / preload / granularity.

Design tokens (`src/styles/index.css`):

- Colors flow only through `--c-*` variables and their Tailwind mappings (`bg-surface`, `text-fg-2`, `text-accent`, …). The light and dark sets must change together, and every foreground/background pair must stay at or above 4.5:1 in both.
- Element base styles go in `@layer base`; component classes go in `@layer components`. **Never add an unlayered element selector** — unlayered CSS outranks every Tailwind utility and once silently killed all button text color classes.
- `:root[data-theme-switching]` suppresses transitions while the theme swaps. Do not remove it; axe otherwise samples interpolated mid-transition colors.
- Keyboard focus always uses `focus-ring`, and motion must respect `prefers-reduced-motion`.
- No page-level horizontal overflow at 320 px.

## 7. Data

Runtime artifacts — `public/charsets/*.json`, `public/freq/han-freq.json`, `src/data/unicode-blocks.json` — are generated. Never hand-edit them.

To add or change a character set:

1. Pin the source snapshot, revision, institution, year, and license under `tools/charset-sources/`. The published `source` must be a reachable absolute HTTPS URL.
2. Update the build script and hard-assert the official entry count and unique code point count.
3. Run build and verify, then update `NOTICE`, `docs/DATA.md`, `src/core/character-settings.ts`, and the tests.

Frequency data is schema v2 with a `hans` profile (SUBTLEX-CH) and a `hant` profile derived through OpenCC, generated by `pnpm frequency:build`.

A new test font must ship an explicit OFL or Apache license and a README inside its `src/test/fixtures/*` directory, and must be registered in `NOTICE`.

## 8. Commands

```bash
pnpm install             # postinstall generates the gitignored src/generated/wawoff2
pnpm dev
pnpm build
pnpm test
pnpm exec vitest run src/core/shard-planner.test.ts
pnpm test:coverage
pnpm test:e2e            # builds first; full suite on Chromium, cross-browser.spec.ts on Firefox and WebKit
pnpm lint                # ESLint + core typecheck + architecture probes
pnpm format
pnpm check               # lint + format:check + coverage + data and icon verification + build
pnpm charsets:build / charsets:verify
pnpm frequency:build / frequency:verify
pnpm unicode-blocks:build / unicode-blocks:verify
pnpm icons:build / icons:verify
pnpm benchmark:planner [font] [--scenario sc-common,sc-full,font-all] [--measure] [--json]
```

`pnpm check` enforces V8 coverage thresholds of 70 statements / 55 branches / 65 functions / 72 lines.

## 9. CI and deployment

`.woodpecker/deploy.yml` is the deployment pipeline, written for Woodpecker 3.19.x and running on the `netcup-nano` agent.

- The pipeline has two steps: `build` (in `node:24.19.0-alpine3.24`, installing pnpm, running `pnpm run check` and `scripts/verify-dist.sh dist`) and `publish` (in `alpine:3.24.1`, mounting `/var/www/webfont.zsh.moe:/deploy` and running `scripts/publish-dist.sh dist <release-id>`).
- `verify-dist.sh` is the gate that a green unit-test run does not replace. It fails when the entry HTML is missing, asset URLs are absolute instead of `./`-relative, no WASM asset shipped, the character set data is absent, or the entry bundle exceeds 300 KiB gzipped. Extend it whenever the build gains a file the app cannot start without.
- The deployment layout matches the other sites on this host: `releases/<id>/` plus a `html` symlink, guarded by `.deploy.lock`. `publish-dist.sh` copies a release, then writes the symlink under a temporary name and renames it over `html`, so a request sees either the old release or the new one. Never replace the deployment root in a single step, never delete the live directory before the new copy is complete, and keep the `flock` — a manual run can overlap a queue drain.
- The pipeline must stay at `concurrency: limit 1`. Two pipelines writing the same deployment root would race.
- The install step sets `pnpm_config_verify_deps_before_run=false` because the lockfile is produced on Windows; the Linux agent must not re-verify the platform-specific dependency graph.
- E2E is deliberately absent from CI. It needs a full Playwright image and adds minutes to every deploy; run `pnpm test:e2e` locally before a release. Do not add it back without agreeing on the runtime cost.
- Web server configurations (Nginx, Caddy, etc.) are managed directly on the host and must never be committed to this repository to prevent leaking infrastructure details. Cache policy: hashed bundles for a year immutable, character data for minutes, the service worker and entry HTML always revalidated. This is a plain static site, so `try_files` ends in `=404`, not an SPA fallback.

## 10. Tests and the definition of done

Every logical batch runs the relevant unit tests and `pnpm check`. Anything touching the UI, Workers, cancellation, downloads, or the PWA also runs `pnpm test:e2e`. Anything touching planning or the size model also runs `pnpm benchmark:planner --measure`.

Regressions that must survive permanently:

- Signature first: a valid font is accepted under any extension; disguised files, TTC, and unknown signatures are rejected before the engine sees them, and a mixed batch keeps its valid entries.
- Malicious WOFF1/WOFF2 directories, oversized expansion, transform versions, 4096 tables, and inflated `totalSfntSize` are all stopped before the decoder or WASM.
- Every available code point appears exactly once across the shard plan; a one-shard target yields a single file.
- The planner's expected traffic beats equal-sized chunking, and size calibration recovers a linear model from real measurements.
- Per-face missing characters and reports across fonts with different cmaps; duplicate faces and duplicate file names are rejected by pre-flight.
- Changing a setting marks the result stale; cancellation allows an immediate retry and late results never write back.
- A hostile family name or URL prefix cannot escape CSS, HTML, or embedded JSON.
- Variable fonts support both axis-preserving and fixed-instance output.
- Western and monospace fonts: script type and monospace are detected, Western/Multilingual take the font's own characters by block without counting missing ones, the tail is cut at script boundaries, and the usage snippet points monospace families at code elements.
- Reopening offline still generates; narrow viewports have no horizontal overflow; key pages have no serious axe violations.

## 11. Pitfalls and non-goals

- React StrictMode is on in development, so effects mount, clean up, and mount again. The cleanup returned by `AppController.start()` must leave the controller able to start again — fresh `AbortController`s and re-queued interrupted work. E2E only exercises the production build, so `controller.test.ts` is the only place these bugs surface.
- Vitest runs in Node by default. A DOM test file declares `// @vitest-environment jsdom` on its first line.
- E2E runs with `zh-CN` and selects by Chinese accessible names. Playwright `name` matching is substring-based by default; use `exact: true` where it matters. Copy changes must update the tests.
- The `@ → src/` alias exists in both `vite.config.ts` and `vitest.config.ts`, and `virtual:pwa-register` maps to `src/test/stubs/pwa-register.ts` under Vitest.
- `tools/benchmark-planner.mjs` loads `src/core` and `src/engine` through Vite SSR, so those modules must stay loadable in Node without browser-only APIs. Worker entry points are the exception.
- Out of scope: splitting TTC/OTC collections, narrowing arbitrary variable axis ranges, a server or CLI build, and OPFS streaming output. Do not add them in passing.
- A release produces a local candidate only: bump `package.json` and `CHANGELOG.md`, run `pnpm check`, `pnpm test:e2e`, and `pnpm benchmark:planner --measure`, confirm first-load JS is ≤ 300 KiB gzipped, run `pnpm audit --prod` and `pnpm licenses list --prod` against `NOTICE`, and verify offline use plus a full CJK generation against `dist/`. Commit, tag, push, and deploy only when the user names the target repository, version, and release requirements.
