import { Check, Copy, FileText, Search, Sparkles } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  EXTRAS,
  LANGUAGES,
  type CoverageLevel,
  type Language,
} from '../../core/character-settings';
import type { CharsetCategory, CharsetSummary } from '../../core/charset-store';
import { differenceSorted } from '../../core/codepoints';
import type { FontScript } from '../../core/font-script';
import { extractCodePoints } from '../../core/text-extract';
import {
  selectCharacterTarget,
  selectExportPlan,
  selectFontScript,
  selectLanguageDetection,
  selectLevelEstimates,
  selectRecommendedLevel,
  type LevelEstimate,
} from '../../app/derive';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController, useServices } from '../app-context';
import { charFor, formatBytes, formatNumber } from '../format';
import { localizeEngineError } from '../messages';
import { Button, Chip, Disclosure, Section, Segmented } from '../primitives';
import { cx, inputClass, useCopy } from '../utils';

const LANGUAGE_LABEL: Record<Language, readonly [zh: string, en: string]> = {
  hans: ['简体', 'Simplified'],
  'hant-tw': ['繁体 · 台湾', 'Traditional · TW'],
  'hant-hk': ['繁体 · 香港', 'Traditional · HK'],
};

interface LevelCopy {
  readonly name: readonly [zh: string, en: string];
  readonly scope: (language: Language) => readonly [zh: string, en: string];
  readonly audience: readonly [zh: string, en: string];
}

/** 西文字体的四档：中间两档按 Unicode 区块取字体自身的字符。 */
const WESTERN_LEVEL_COPY: Record<CoverageLevel, LevelCopy> = {
  text: {
    name: ['仅文本', 'Text only'],
    scope: () => ['只有你粘贴的文字', 'Only the text you paste'],
    audience: ['标题、Logo、活动页', 'Headlines, logos, campaigns'],
  },
  common: {
    name: ['西欧', 'Western'],
    scope: () => ['拉丁字母、拉丁-1 与常用标点', 'Basic Latin, Latin-1, punctuation'],
    audience: ['英文与西欧语言网站', 'English and Western European sites'],
  },
  full: {
    name: ['多语言', 'Multilingual'],
    scope: () => ['再加拉丁扩展、希腊、西里尔', 'Plus Latin Extended, Greek, Cyrillic'],
    audience: ['多语言产品、中东欧、越南文', 'Multilingual, Central European, Vietnamese'],
  },
  all: {
    name: ['全部', 'Everything'],
    scope: () => ['字体里的每一个字符', 'Every character in the font'],
    audience: ['代码、终端、图标，不能缺字', 'Code, terminals, icons, no gaps'],
  },
};

const LEVEL_COPY: Record<CoverageLevel, LevelCopy> = {
  text: {
    name: ['仅文本', 'Text only'],
    scope: () => ['只有你粘贴的文字', 'Only the text you paste'],
    audience: ['标题、Logo、活动页', 'Headlines, logos, campaigns'],
  },
  common: {
    name: ['常用', 'Common'],
    scope: (language) =>
      language === 'hans'
        ? ['3,500 个常用汉字', '3,500 common characters']
        : language === 'hant-tw'
          ? ['教育部常用国字', 'MOE common characters']
          : ['香港常用字', 'HK common characters'],
    audience: ['博客、作品集、落地页', 'Blogs, portfolios, landing pages'],
  },
  full: {
    name: ['完整', 'Full'],
    scope: (language) =>
      language === 'hans'
        ? ['8,105 个规范汉字', '8,105 standard characters']
        : language === 'hant-tw'
          ? ['Big5 全部汉字', 'All Big5 characters']
          : ['常用字 + HKSCS', 'Common + HKSCS'],
    audience: ['内容站、文档、官网', 'Content sites, docs, corporate'],
  },
  all: {
    name: ['全部', 'Everything'],
    scope: () => ['字体里的每一个字符', 'Every character in the font'],
    audience: ['产品、多语言、不能缺字', 'Products, multilingual, no gaps'],
  },
};

function levelCopy(script: FontScript): Record<CoverageLevel, LevelCopy> {
  return script === 'western' ? WESTERN_LEVEL_COPY : LEVEL_COPY;
}

/** 西文字体没有简繁之分：说明按文字分片，代替语言选择。 */
function ScriptRow() {
  const { text } = usePreferences();
  const monospace = useAppState(
    (state) => state.fonts.find((font) => font.status === 'ready')?.inspection?.monospace ?? false,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="w-full text-[13px] font-medium text-fg-2 sm:w-auto">
        {text('文字', 'Script')}
      </h3>
      <span className="flex items-center gap-1.5">
        <span className="rounded-md bg-hover px-2 py-0.5 text-[12.5px] font-medium text-fg-2">
          {text('西文', 'Latin & other scripts')}
        </span>
        {monospace ? (
          <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[12.5px] font-medium text-accent">
            {text('等宽', 'Monospace')}
          </span>
        ) : null}
      </span>
      <span className="text-[12.5px] text-fg-3">
        {text(
          '字体不含汉字：拉丁、希腊、西里尔、符号与图标各自成片',
          'No Han characters: Latin, Greek, Cyrillic, symbols and icons each get their own shards',
        )}
      </span>
    </div>
  );
}

function LanguageRow() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const setting = useAppState((state) => state.characters.language);
  const detection = useAppState(selectLanguageDetection);
  const running = useAppState((state) => state.run.phase === 'running');
  const script = useAppState(selectFontScript);
  if (script === 'western') return <ScriptRow />;
  const basis = {
    setting: text('手动选择', 'Manual'),
    font: text('按字体覆盖判断', 'Detected from the font'),
    text: text('按你的文本判断', 'Detected from your text'),
    default: text('尚无依据，默认简体', 'No signal yet; defaulting to Simplified'),
  }[detection.basis];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="w-full text-[13px] font-medium text-fg-2 sm:w-auto">
        {text('语言', 'Language')}
      </h3>
      <Segmented
        disabled={running}
        label={text('语言', 'Language')}
        onChange={(value) => {
          controller.updateCharacters((current) => ({ ...current, language: value }));
        }}
        options={LANGUAGES.map((language) => ({
          value: language,
          label: locale === 'en' ? LANGUAGE_LABEL[language][1] : LANGUAGE_LABEL[language][0],
        }))}
        size="sm"
        value={detection.language}
      />
      <span className="text-[12.5px] text-fg-3">
        {setting === 'auto' ? (
          <>
            <span className="mr-1 rounded bg-hover px-1.5 py-0.5 text-[11.5px] font-medium text-fg-2">
              {text('自动', 'Auto')}
            </span>
            {basis}
          </>
        ) : (
          <>
            {basis}
            <button
              className="focus-ring ml-1.5 rounded text-accent hover:underline"
              disabled={running}
              onClick={() => {
                controller.updateCharacters((current) => ({ ...current, language: 'auto' }));
              }}
              type="button"
            >
              {text('改回自动', 'Back to auto')}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function LevelCard({
  estimate,
  language,
  script,
  selected,
  recommended,
  disabled,
  onSelect,
}: {
  readonly estimate: LevelEstimate;
  readonly language: Language;
  readonly script: FontScript;
  readonly selected: boolean;
  readonly recommended: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const { text, locale } = usePreferences();
  const copy = levelCopy(script)[estimate.level];
  const pick = (pair: readonly [string, string]) => (locale === 'en' ? pair[1] : pair[0]);
  const characters = estimate.characters;
  return (
    <label
      className={cx(
        'focus-ring-within relative flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3.5 transition-[border-color,background-color,box-shadow] duration-150',
        selected
          ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--c-accent)]'
          : 'border-line hover:border-line-strong hover:bg-hover/50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        checked={selected}
        className="sr-only"
        disabled={disabled}
        name="coverage-level"
        onChange={onSelect}
        type="radio"
      />
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-fg">{pick(copy.name)}</span>
          {recommended ? (
            <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold text-accent-fg">
              {text('推荐', 'Pick')}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cx(
            'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
            selected ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
          )}
        >
          {selected ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
        </span>
      </span>
      <span className="grid gap-0.5 text-[12.5px] leading-5">
        <span className="text-fg-2">{pick(copy.scope(language))}</span>
        <span className="text-fg-3">{pick(copy.audience)}</span>
      </span>
      <span className="mt-auto grid gap-0.5 border-t border-line/70 pt-2.5 text-[12.5px] leading-5 tabular">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-fg-3">{text('字数', 'Characters')}</span>
          <span className="font-medium text-fg">
            {characters === null ? '…' : formatNumber(characters, locale)}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-fg-3">{text('每页下载', 'Per page')}</span>
          <span className="font-medium text-fg">
            {estimate.pageBytes === null ? '—' : `≈ ${formatBytes(estimate.pageBytes)}`}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-fg-3">{text('文件', 'Files')}</span>
          <span className="text-fg-2">
            {estimate.shardCount === null || estimate.totalBytes === null
              ? '—'
              : `${formatNumber(estimate.shardCount, locale)} · ${formatBytes(estimate.totalBytes)}`}
          </span>
        </span>
      </span>
    </label>
  );
}

function LevelLadder() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const level = useAppState((state) => state.characters.level);
  const language = useAppState((state) => selectLanguageDetection(state).language);
  const running = useAppState((state) => state.run.phase === 'running');
  const hasFont = useAppState((state) => state.fonts.some((font) => font.status === 'ready'));
  const recommended = useAppState(selectRecommendedLevel);
  const script = useAppState(selectFontScript);
  // 四档各规划一次；拖动粒度滑杆时先更新主计划，对比数字随后跟上。
  const estimates = useDeferredValue(useAppState(selectLevelEstimates));
  const custom = useAppState((state) => selectCharacterTarget(state).customCodePoints.length);

  const common = estimates.find((item) => item.level === 'common');
  const all = estimates.find((item) => item.level === 'all');
  const insight =
    common?.pageBytes != null && all?.pageBytes != null && all.characters != null
      ? all.pageBytes - common.pageBytes
      : null;
  const [commonZh, commonEn] = levelCopy(script).common.name;

  const textOnly: readonly [string, string] = [
    custom > 0
      ? `只包含下面文本里的 ${formatNumber(custom, locale)} 个字符，其他字会用系统字体显示。`
      : '只包含下面粘贴的文字。先在"你的文本"里放入标题或文案。',
    custom > 0
      ? `Only the ${formatNumber(custom, locale)} characters in your text below; anything else falls back to a system font.`
      : 'Only the text you paste below. Add your headline or copy first.',
  ];
  const explanation: Record<CoverageLevel, readonly [string, string]> =
    script === 'western'
      ? {
          text: textOnly,
          common: [
            '英文与西欧语言用到的字母、标点与货币符号。字体里其他文字的字符不打包，会用系统字体显示。',
            'Letters, punctuation and currency signs for English and Western European languages. Other scripts in the font are left out and fall back to a system font.',
          ],
          full: [
            '再加中东欧、越南文、希腊文与西里尔文。每种文字单独成片，页面只下载用到的那几片。',
            'Adds Central European, Vietnamese, Greek and Cyrillic. Each script gets its own shards, so a page only downloads the ones it uses.',
          ],
          all: [
            '字体里的每一个字符，包括制表符、箭头、数学符号与图标。它们各自成片，用到时才下载。',
            'Every character in the font, including box drawing, arrows, math and icons. Each group gets its own shards and loads only when used.',
          ],
        }
      : {
          text: textOnly,
          common: [
            '日常文章 99.5% 的字都在这里。写博客的推荐做法：选这一档，再把几篇文章粘贴到下面——文章里的生僻字会自动补上，你常用的字会优先加载。',
            'Covers 99.5% of everyday text. For a blog: pick this, then paste a few posts below. Rare characters from your posts are added automatically, and the ones you use most load first.',
          ],
          full: [
            '标准里的全部规范汉字，正文基本不会缺字。每页下载量与"常用"几乎相同，只是文件总数更多。',
            'Every standard character; body text almost never falls back. Per-page download is nearly the same as Common; only the total file count grows.',
          ],
          all: [
            '字体里的每一个字符都会被切片，包括生僻字、假名、谚文。每页下载量几乎不变，只是文件更多。',
            'Every character in the font is sharded, including rare ones, kana and hangul. Per-page download barely changes; there are just more files.',
          ],
        };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-fg-2">{text('覆盖范围', 'Coverage')}</h3>
        {insight !== null && all?.characters != null && common?.characters != null ? (
          <p className="text-[12.5px] text-fg-3">
            {text(
              `从「${commonZh}」扩到「全部」（${formatNumber(all.characters, locale)} 字），每页只多下载约 ${formatBytes(Math.max(0, insight))}`,
              `Going from ${commonEn} to Everything (${formatNumber(all.characters, locale)} chars) adds only ≈ ${formatBytes(Math.max(0, insight))} per page`,
            )}
          </p>
        ) : null}
      </div>
      <div
        aria-label={text('覆盖范围', 'Coverage')}
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
        role="radiogroup"
      >
        {estimates.map((estimate) => (
          <LevelCard
            disabled={running}
            estimate={estimate}
            key={estimate.level}
            language={language}
            onSelect={() => {
              controller.updateCharacters((current) => ({ ...current, level: estimate.level }));
            }}
            recommended={estimate.level === recommended && hasFont}
            script={script}
            selected={level === estimate.level}
          />
        ))}
      </div>
      <p className="flex gap-2 text-[13px] leading-5 text-fg-2">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <span>{locale === 'en' ? explanation[level][1] : explanation[level][0]}</span>
      </p>
    </div>
  );
}

function CustomText() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const { platform } = useServices();
  const stored = useAppState((state) => state.characters.customText);
  const level = useAppState((state) => state.characters.level);
  const target = useAppState(selectCharacterTarget);
  const running = useAppState((state) => state.run.phase === 'running');
  const [draft, setDraft] = useState(stored);
  const [importError, setImportError] = useState<string | null>(null);
  const deferred = useDeferredValue(draft);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (deferred === stored) return;
    const timer = setTimeout(() => {
      controller.updateCharacters((settings) => ({ ...settings, customText: deferred }));
    }, 220);
    return () => {
      clearTimeout(timer);
    };
  }, [controller, deferred, stored]);

  const localCodePoints = useMemo(
    () => [...extractCodePoints(deferred)].sort((a, b) => a - b),
    [deferred],
  );
  const added = useMemo(
    () => differenceSorted(localCodePoints, target.rangeCodePoints),
    [localCodePoints, target.rangeCodePoints],
  );
  const hasPresets = level === 'common' || level === 'full';
  const implied = target.impliedExtras;
  const western = target.script === 'western';

  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-fg-2">
          {text('你的文本', 'Your text')}
          <span className="ml-1.5 font-normal text-fg-3">
            {level === 'text' ? text('必填', 'Required') : text('可选', 'Optional')}
          </span>
        </h3>
        <p className="text-[12.5px] text-fg-3">
          {western
            ? text(
                '粘贴文章或代码：补上范围外的字符，并让用到的字符优先加载',
                'Paste posts or code: fills gaps and loads the characters you use first',
              )
            : text(
                '粘贴几篇文章或整站文案：补上字表外的字，并让常用字优先加载',
                'Paste a few posts or your site copy: fills gaps and loads your common characters first',
              )}
        </p>
      </div>
      <textarea
        aria-describedby={`${id}-stats`}
        aria-label={text('你的文本', 'Your text')}
        className="focus-ring scrollbar-thin block min-h-24 w-full resize-y rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-[14px] leading-6 text-fg placeholder:text-fg-3 hover:border-fg-3"
        disabled={running}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        placeholder={
          western
            ? text(
                '在这里粘贴文章、README 或代码片段…',
                'Paste articles, a README or code snippets here…',
              )
            : text(
                '在这里粘贴文章、标题或品牌文案…',
                'Paste articles, headlines or brand copy here…',
              )
        }
        spellCheck={false}
        value={draft}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div
          aria-live="polite"
          className="min-w-0 flex-1 text-[13px] leading-5 text-fg-3 tabular"
          id={`${id}-stats`}
        >
          {localCodePoints.length === 0 ? (
            <span>{text('还没有文本', 'No text yet')}</span>
          ) : (
            <>
              <span className="text-fg-2">
                {text(
                  `${formatNumber(localCodePoints.length, locale)} 个不同字符`,
                  `${formatNumber(localCodePoints.length, locale)} unique characters`,
                )}
              </span>
              {hasPresets && target.status === 'ready' ? (
                added.length === 0 ? (
                  <span>
                    {western
                      ? text('，全部已在所选范围中', ', all already in range')
                      : text('，全部已在字表中', ', all already in the set')}
                  </span>
                ) : (
                  <>
                    <span>
                      {western
                        ? text(
                            `，其中 ${formatNumber(added.length, locale)} 个不在所选范围中，已自动补上：`,
                            `, ${formatNumber(added.length, locale)} outside the range were added: `,
                          )
                        : text(
                            `，其中 ${formatNumber(added.length, locale)} 个不在字表中，已自动补上：`,
                            `, ${formatNumber(added.length, locale)} not in the set were added: `,
                          )}
                    </span>
                    <span
                      className="text-[15px] tracking-[0.15em] text-fg"
                      lang={western ? undefined : 'zh'}
                    >
                      {added.slice(0, 24).map(charFor).join('')}
                      {added.length > 24 ? '…' : ''}
                    </span>
                  </>
                )
              ) : null}
              {implied.length > 0 ? (
                <span className="block text-fg-2">
                  {text(
                    `检测到${implied.map((extra) => (extra === 'kana' ? '假名' : '谚文')).join('与')}，已自动加入整套字符`,
                    `Detected ${implied.map((extra) => (extra === 'kana' ? 'kana' : 'hangul')).join(' and ')}; the full set was added`,
                  )}
                </span>
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            accept=".txt,.md,.html,text/plain,text/markdown,text/html"
            aria-hidden="true"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file === undefined) return;
              setImportError(null);
              platform.readTextFile(file).then(
                (content) => {
                  setDraft((current) =>
                    current.length === 0 ? content : `${current}\n${content}`,
                  );
                },
                (error: unknown) => {
                  setImportError(error instanceof Error ? error.message : String(error));
                },
              );
            }}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
          <Button
            disabled={running}
            icon={<FileText className="size-3.5" />}
            onClick={() => fileInput.current?.click()}
            size="sm"
            variant="ghost"
          >
            {text('导入文件', 'Import file')}
          </Button>
          {draft.length > 0 ? (
            <Button
              disabled={running}
              onClick={() => {
                setDraft('');
              }}
              size="sm"
              variant="ghost"
            >
              {text('清空', 'Clear')}
            </Button>
          ) : null}
        </div>
      </div>
      {importError === null ? null : (
        <p className="text-[13px] text-danger" role="alert">
          {localizeEngineError(importError, text)}
        </p>
      )}
    </div>
  );
}

function MissingPanel() {
  const { text, locale } = usePreferences();
  const { platform } = useServices();
  const plan = useAppState(selectExportPlan);
  const fonts = useAppState((state) => state.fonts);
  const { copied, run } = useCopy(platform.copyText);
  const [expanded, setExpanded] = useState(false);
  const bySource = useMemo(() => {
    const seen = new Set<string>();
    return (plan?.outputs ?? []).filter((output) => {
      if (seen.has(output.sourceId) || output.missing.length === 0) return false;
      seen.add(output.sourceId);
      return true;
    });
  }, [plan]);
  if (bySource.length === 0) return null;
  return (
    <div className="grid gap-3 rounded-lg border border-warn/30 bg-warn-soft/60 p-3">
      {bySource.map((output) => {
        const name =
          fonts.find((font) => font.id === output.sourceId)?.inspection?.fullName ??
          output.sourceFileName;
        const shown = expanded ? output.missing : output.missing.slice(0, 120);
        const chars = output.missing.map(charFor).join('');
        return (
          <div className="grid gap-1.5" key={output.sourceId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-fg-2">
                <span className="font-medium text-warn">
                  {text(
                    `${name} 缺 ${formatNumber(output.missing.length, locale)} 字`,
                    `${name} is missing ${formatNumber(output.missing.length, locale)}`,
                  )}
                </span>
                <span className="text-fg-3">
                  {' · '}
                  {text('这些字会由系统字体显示', 'shown with the system font')}
                </span>
              </p>
              <Button
                icon={
                  copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />
                }
                onClick={() => {
                  run(chars);
                }}
                size="sm"
                variant="ghost"
              >
                {copied ? text('已复制', 'Copied') : text('复制', 'Copy')}
              </Button>
            </div>
            <p
              className="scrollbar-thin max-h-32 overflow-auto text-[17px] leading-7 tracking-[0.2em] break-all text-fg"
              lang="zh"
            >
              {shown.map(charFor).join('')}
              {output.missing.length > shown.length ? (
                <button
                  className="focus-ring ml-2 rounded px-1 align-middle text-[13px] tracking-normal text-accent hover:underline"
                  onClick={() => {
                    setExpanded(true);
                  }}
                  type="button"
                >
                  {text(
                    `展开全部 ${formatNumber(output.missing.length, locale)}`,
                    `Show all ${formatNumber(output.missing.length, locale)}`,
                  )}
                </button>
              ) : null}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const CATEGORY_ORDER: readonly CharsetCategory[] = [
  'simplified',
  'traditional',
  'unicode',
  'functional',
];

function PresetLibrary() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const index = useAppState((state) => state.data.index);
  const presets = useAppState((state) => state.data.presets);
  const settings = useAppState((state) => state.characters);
  const target = useAppState(selectCharacterTarget);
  const running = useAppState((state) => state.run.phase === 'running');
  const [query, setQuery] = useState('');
  const inherited = useMemo(
    () => new Set(target.presetIds.filter((id) => !settings.libraryIds.includes(id))),
    [settings.libraryIds, target.presetIds],
  );
  if (index === null)
    return (
      <p className="text-[13px] text-fg-3">{text('正在载入字表目录…', 'Loading catalogue…')}</p>
    );
  const normalized = query.trim().toLowerCase();
  const matches = (preset: CharsetSummary) =>
    normalized.length === 0 ||
    `${preset.name} ${preset.standard} ${preset.description} ${preset.id}`
      .toLowerCase()
      .includes(normalized);
  const categoryLabel: Record<CharsetCategory, string> = {
    simplified: text('简体标准', 'Simplified'),
    traditional: text('繁体标准', 'Traditional'),
    unicode: text('Unicode 区块', 'Unicode blocks'),
    functional: text('拉丁、数字与标点', 'Latin, digits & punctuation'),
  };
  const locked = running || settings.level === 'all';
  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3"
        />
        <input
          aria-label={text('搜索字表', 'Search sets')}
          className={cx(inputClass, 'pl-9')}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={text('搜索 GB 2312、Big5、假名…', 'Search GB 2312, Big5, kana…')}
          type="search"
          value={query}
        />
      </div>
      {settings.level === 'all' ? (
        <p className="text-[13px] text-fg-3">
          {text(
            '「全部」已包含字体的每一个字符，字表库不再需要。',
            '"Everything" already includes every character in the font.',
          )}
        </p>
      ) : null}
      {CATEGORY_ORDER.map((category) => {
        const items = index.presets.filter(
          (preset) => preset.category === category && matches(preset),
        );
        if (items.length === 0) return null;
        return (
          <fieldset className="grid gap-0.5" key={category}>
            <legend className="mb-1 text-[12px] font-medium tracking-wide text-fg-3 uppercase">
              {categoryLabel[category]}
            </legend>
            {items.map((preset) => {
              const included = inherited.has(preset.id);
              const checked = included || settings.libraryIds.includes(preset.id);
              const loaded = presets.get(preset.id);
              return (
                <label
                  className={cx(
                    'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-1.5 hover:bg-hover',
                    (included || locked) && 'cursor-default',
                  )}
                  key={preset.id}
                >
                  <input
                    checked={checked}
                    className="focus-ring mt-1 size-4 accent-[var(--c-accent)]"
                    disabled={included || locked}
                    onChange={(event) => {
                      const on = event.target.checked;
                      controller.updateCharacters((current) => ({
                        ...current,
                        libraryIds: on
                          ? [...new Set([...current.libraryIds, preset.id])]
                          : current.libraryIds.filter((id) => id !== preset.id),
                      }));
                    }}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-fg">
                      {preset.name}
                      {included ? (
                        <span className="ml-2 text-[12px] text-accent">
                          {text('已随范围包含', 'included by coverage')}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-fg-3">
                      {preset.standard}
                      {loaded === undefined ? null : (
                        <>
                          {' · '}
                          <a
                            className="focus-ring rounded hover:text-accent hover:underline"
                            href={loaded.source}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {text('来源', 'Source')}
                          </a>
                          {' · '}
                          {loaded.license}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="pt-0.5 text-[12px] text-fg-3 tabular">
                    {formatNumber(preset.expectedCount, locale)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
      {target.failedPresetIds.length > 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-danger" role="alert">
          {text('部分字表载入失败', 'Some sets failed to load')}
          <Button
            onClick={() => {
              controller.retryData();
            }}
            size="sm"
          >
            {text('重试', 'Retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Advanced() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const settings = useAppState((state) => state.characters);
  const target = useAppState(selectCharacterTarget);
  const running = useAppState((state) => state.run.phase === 'running');
  const id = useId();
  // 西文字体不使用附加字符（见 requiredPresetIds），只计字表库。
  const western = target.script === 'western';
  const extrasCount = (western ? 0 : settings.extras.length) + settings.libraryIds.length;
  const aside =
    extrasCount > 0
      ? text(`已加 ${String(extrasCount)} 项`, `${String(extrasCount)} added`)
      : western
        ? text('码点区间、31 份标准字表', 'Code point ranges, 31 standard sets')
        : text('附加字符、码点区间、31 份标准字表', 'Extras, code point ranges, 31 standard sets');
  return (
    <Disclosure aside={aside} summary={text('高级', 'Advanced')}>
      <div className="grid gap-5">
        <div className={cx('grid gap-2', western && 'hidden')}>
          <p className="text-[13px] text-fg-2">
            {text('附加字符', 'Extra characters')}
            <span className="ml-1.5 text-fg-3">
              {text(
                '拉丁字母、数字与中西文标点已随「常用」「完整」自动包含',
                'Latin, digits and punctuation are already included with Common and Full',
              )}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXTRAS.map((extra) => {
              const implied = target.impliedExtras.includes(extra.id);
              const pressed = implied || settings.extras.includes(extra.id);
              return (
                <Chip
                  disabled={running || implied || settings.level === 'all'}
                  key={extra.id}
                  onClick={() => {
                    controller.updateCharacters((current) => ({
                      ...current,
                      extras: pressed
                        ? current.extras.filter((item) => item !== extra.id)
                        : [...current.extras, extra.id],
                    }));
                  }}
                  pressed={pressed}
                  {...(implied
                    ? { title: text('由你的文本自动加入', 'Added from your text') }
                    : {})}
                >
                  {locale === 'en' ? extra.name[1] : extra.name[0]}
                  <span className="text-fg-3">{extra.sample}</span>
                </Chip>
              );
            })}
          </div>
        </div>
        <div className="grid gap-1.5">
          <label className="text-[13px] text-fg-2" htmlFor={`${id}-ranges`}>
            {text('码点区间', 'Code point ranges')}
          </label>
          <input
            aria-describedby={`${id}-ranges-hint`}
            aria-invalid={target.rangeErrors.length > 0}
            className={cx(inputClass, 'font-mono text-[13px]')}
            disabled={running}
            id={`${id}-ranges`}
            onChange={(event) => {
              const value = event.target.value;
              controller.updateCharacters((current) => ({ ...current, customRanges: value }));
            }}
            placeholder="U+4E00-4E80, U+3001, U+FF0C"
            spellCheck={false}
            value={settings.customRanges}
          />
          <p className="text-[12.5px] text-fg-3" id={`${id}-ranges-hint`}>
            {target.rangeErrors.length > 0 ? (
              <span className="text-danger" role="alert">
                {target.rangeErrors
                  .slice(0, 3)
                  .map((error) => `“${error.token}”`)
                  .join(' ')}{' '}
                {text(
                  '格式有误，请使用 U+4E00 或 U+4E00-9FFF',
                  'is invalid; use U+4E00 or U+4E00-9FFF',
                )}
              </span>
            ) : (
              text(
                '用逗号或空格分隔，例如 U+4E00-9FFF',
                'Separate with commas or spaces, e.g. U+4E00-9FFF',
              )
            )}
          </p>
        </div>
        <div className="grid gap-2">
          <p className="text-[13px] text-fg-2">{text('字表库', 'Character set library')}</p>
          <PresetLibrary />
        </div>
      </div>
    </Disclosure>
  );
}

export function CharactersSection() {
  const { text, locale } = usePreferences();
  const target = useAppState(selectCharacterTarget);
  const plan = useAppState(selectExportPlan);
  const primary = plan?.outputs.find((output) => output.id === plan.primaryOutputId);
  // 按字体自身覆盖取字的档位没有"字体缺字"，需要数即可用数。
  const fromFont = target.allFontCharacters || target.fontRanges.length > 0;

  const summary =
    target.status === 'loading'
      ? text('载入中…', 'Loading…')
      : primary === undefined
        ? text(
            `${formatNumber(target.requested.length, locale)} 字`,
            `${formatNumber(target.requested.length, locale)} chars`,
          )
        : text(
            `需要 ${formatNumber(fromFont ? primary.available.length : target.requested.length, locale)} · 可用 ${formatNumber(primary.available.length, locale)}`,
            `${formatNumber(fromFont ? primary.available.length : target.requested.length, locale)} requested · ${formatNumber(primary.available.length, locale)} available`,
          );

  return (
    <Section
      aside={<span className="pt-0.5 text-[13px] font-medium text-fg-2 tabular">{summary}</span>}
      description={
        target.script === 'western'
          ? text(
              '选择要打包的文字。每种文字单独成片，页面只会下载用到的那几片。',
              'Pick which scripts to ship. Each script gets its own shards; pages only download the ones they use.',
            )
          : text(
              '网页字体不需要包含全部三万个字。选一个范围，页面只会下载用到的那部分。',
              'A web font does not need all 30,000 characters. Pick a range; pages only download what they use.',
            )
      }
      id="characters"
      index="02"
      title={text('字符', 'Characters')}
    >
      <div className="grid gap-6">
        <LanguageRow />
        <LevelLadder />
        <CustomText />
        <MissingPanel />
        <div className="border-t border-line pt-3">
          <Advanced />
        </div>
      </div>
    </Section>
  );
}
