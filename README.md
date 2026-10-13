# WebFont Slice

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

Slice Chinese, Japanese and Korean web fonts into on-demand WOFF2 shards and generate `unicode-range` CSS you can deploy as-is. Latin and monospace code fonts are split by script, with ligatures and stylistic sets intact. Everything runs locally in the browser — fonts are never uploaded.

Source: <https://github.com/DejavuMoe/webfont-slice> (MIT)

![WebFont Slice workbench with Noto Sans SC Variable loaded](docs/images/workbench-cjk.png)

A single CJK font is often 7–20 MB. WebFont Slice estimates how likely each character is to appear on a page from real corpus frequency, then uses dynamic programming to decide where to cut, so a page downloads only the glyphs it actually renders:

| Coverage (Noto Sans SC Variable)            | Characters | Single file (measured) | Article page download (measured) | vs. single file |
| ------------------------------------------- | ---------: | ---------------------: | -------------------------------: | --------------: |
| Common (level 1 of the 2013 standard table) |      3,701 |                 945 KB |              810 KB · 12.5 files |            −14% |
| Full (the whole standard table)             |      8,306 |                2.13 MB |              868 KB · 14.9 files |            −60% |
| GBK (character set library)                 |     21,124 |                5.37 MB |              879 KB · 15.1 files |            −84% |
| Everything (every glyph in the font)        |     30,890 |                7.41 MB |              891 KB · 15.1 files |            −88% |

The per-page download barely depends on how large the character set is: growing from 3,000 to 30,000 characters adds about 80 KB to an article page. These numbers come from `pnpm benchmark:planner --measure`, which subsets every shard for real and then weights by frequency; see [`docs/SHARDING.md`](docs/SHARDING.md) for the method and more fonts.

### Latin and code fonts

Fonts without Han characters — Latin text faces, monospace code fonts such as JetBrains Mono and Fira Code, icon-bearing Nerd Fonts — are detected automatically. Coverage switches to four levels defined by Unicode block: Text only, Western, Multilingual (adding Latin Extended, Greek and Cyrillic), and Everything. The two middle levels take only the characters the font actually has, so you never get hundreds of phantom "missing" glyphs. ASCII and common punctuation go into the base shard; the rest is packed by script group, so Greek, Cyrillic, box drawing and arrows, and private-use icons each get their own shards. A pure-English page usually downloads just the base shard.

| Font (everything)    | Characters | Shards | Single file (measured) | A page usually downloads |
| -------------------- | ---------: | -----: | ---------------------: | -----------------------: |
| JetBrains Mono 2.304 |      1,363 |      5 |                  55 KB |         19 KB base shard |
| Fira Code 6.2        |      1,586 |      6 |                  67 KB |         23 KB base shard |

Monospace fonts are flagged. With "Keep layout features" on (the default), subsetting preserves `ss01`–`ss20` stylistic sets and `cv01`–`cv99` character variants on top of `calt`/`liga` ligatures, so you can switch them from your own CSS with `font-feature-settings`. The generated usage snippet points monospace families at `code, kbd, samp, pre`, and the result page and `demo.html` preview with a code sample.

## Three steps

1. **Drop in a font.** TTF, OTF, WOFF or WOFF2, identified by file signature, up to 100 MB each. Several weights of the same family can go in together.
2. **Pick coverage.** Language is detected automatically. The four levels ladder up from small to large — Text only, Common, Full, Everything (Text only, Western, Multilingual, Everything for Latin fonts), each showing its character count, estimated per-page download and file count as you go. The recommended setup for a blog: choose Common, then paste a few articles into "Your text" so uncommon characters are added and frequent ones load first.
3. **Generate and deploy.** The plan panel on the right shows estimated per-page download, request count and per-shard load probability; drag the granularity slider and it updates live. After generating, type into the page to try it — the browser requests only the shards it needs. Download a ZIP or write straight into a project folder.

```text
<family>-webfont.zip
├─ fonts.css      @font-face + unicode-range, declaring only your font
├─ fonts/         WOFF2 shards with content-hashed file names
├─ preload.html   preload tags
├─ demo.html      watch shards load on demand
├─ report.json    per-shard characters, sizes and load probabilities
└─ README.md      deployment notes for this run
```

Deployment is covered in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

![Result page: the browser requested 7 of 26 shards for the sample text](docs/images/result.png)

## Features

- **Sharded by frequency.** Frequent characters merge into a few files, mid-frequency ranges are cut finer, the long tail is packed in code point order. The base characters get their own shard and are recommended for preload. One slider runs from "fewer bytes" to "fewer files".
- **You know the result before generating.** The size model is calibrated against four real subsetting runs on your font, keeping shard-total estimates within ±3.5%; estimated per-page download lands within −1% to +4% of measured. Every number the UI shows is computed.
- **Slicing only.** The CSS declares your uploaded font and nothing else — no fallback faces, no metric overrides. The fallback stack is yours to write. Output includes content-hashed file names, preload tags, deployment notes and a per-shard report. The file name prefix defaults to the family name and can be customized (`lxgw-400-87.f73f604a.woff2`). Path and `font-display` only affect the CSS, so changing them on the result page updates the code and ZIP immediately.
- **A real on-demand loading playground.** After generating, type text into the page and the browser requests only the shards that `unicode-range` matches. The UI lists the files it actually requested.
- **Standard character sets.** Table of General Standard Chinese Characters, MOE common characters, Hong Kong common graphemes and HKSCS, Big5, GB 2312 / GBK / GB 18030, plus Unicode blocks. Separate frequency profiles for Simplified and Traditional.
- **Latin and code fonts.** Detects fonts without Han characters and monospace fonts, splits by script, and preserves ligatures, stylistic sets and character variants.
- **Variable fonts.** Keep the variable axes, or pick just the named instances you need as fixed faces.
- **Multithreaded.** Thread count follows font size and device memory; a 17 MB Noto Sans SC Variable produces 26 shards in about a second.
- **Local and offline.** No backend and no telemetry. A PWA, so it works offline after the first visit. Chinese and English interface, light and dark themes, and a collapsible bottom plan sheet on phones.

## Privacy and licensing

- There is no backend. Inspection, subsetting, WOFF2 encoding and packing all happen in Web Workers and WASM on the current page. The browser only requests the app assets, the WASM, the character set and frequency JSON, and Service Worker updates.
- `localStorage` holds interface preferences and character/sharding/output settings only. **Custom text is never stored.** Fonts, shards and ZIPs exist only in memory and wherever you choose to download them.
- **This tool grants no font rights.** Subsetting usually counts as modification, and web deployment usually counts as embedding and redistribution. Many commercial licenses forbid both; check before deploying. The default "trim metadata" only drops `name` records a web page never reads — copyright, family, license description and license URL are always kept.

## Development

Requires Node.js 24+ and pnpm 11.24+.

```bash
corepack enable
pnpm install          # also generates the locally split wawoff2 WASM
pnpm dev              # http://localhost:5173
pnpm check            # lint + architecture probes + format + unit tests & coverage + data verification + build
pnpm test:e2e         # builds first, then Playwright (full Chromium suite, main flow on Firefox and WebKit)
pnpm benchmark:planner path/to/font.ttf --measure
```

`pnpm build` produces a purely static `dist/` that deploys to any static host, subpaths included, with no extra configuration.

## Non-goals

- A server, CLI or build-plugin version. This is a browser application only.
- Splitting TTC/OTC collections. Export a single face first.
- Arbitrary variable axis coordinates or sub-ranges, and automatic family splitting by `opsz`.
- Glyph editing, font merging, or font transformation beyond format conversion.

## Documentation

- [`docs/SHARDING.md`](docs/SHARDING.md) — sharding model, objective function, size estimation, benchmarks and performance
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, state, interface, Workers and variable fonts
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying the tool itself and the generated fonts
- [`docs/DATA.md`](docs/DATA.md) — sources for the character sets and frequency data
- [`AGENTS.md`](AGENTS.md) — contribution and coding-agent rules
- [`CHANGELOG.md`](CHANGELOG.md) — release history

## License

Code is [MIT](LICENSE) licensed. Third-party dependencies, data and test fonts are listed in [`NOTICE`](NOTICE). Questions and suggestions go to [GitHub Issues](https://github.com/DejavuMoe/webfont-slice/issues).
