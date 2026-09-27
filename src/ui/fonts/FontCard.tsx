import { AlertTriangle, Check, LoaderCircle, RotateCw, Trash2 } from 'lucide-react';
import { useId, useMemo } from 'react';
import { intersectSorted } from '../../core/codepoints';
import { isExternalHttpUrl } from '../../core/charset-store';
import { shardFileName, type FaceDraft } from '../../core/export-plan';
import type { FontInspection } from '../../core/font-inspection';
import type { FontStyle } from '../../core/css-gen';
import { formatLabel } from '../../core/font-format';
import { classifyFontScript, type FontScript } from '../../core/font-script';
import { isRetainedLayoutFeature } from '../../core/layout-features';
import { filePrefixFor, isValidFilePrefix } from '../../core/naming';
import { selectableVariationInstances } from '../../core/variation';
import { selectExportPlan } from '../../app/derive';
import type { FontEntry } from '../../app/state';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController } from '../app-context';
import { formatBytes, formatNumber, formatPercent } from '../format';
import { describeWarning, localizeEngineError } from '../messages';
import { Chip, Disclosure, Field, IconButton, Segmented } from '../primitives';
import { cx, inputClass } from '../utils';
import { usePreviewFamily } from './preview-context';

const SAMPLE_ZH = '天地玄黄 宇宙洪荒 永和九年';
const SAMPLE_LATIN = 'Aa Bb 0123';
const SAMPLE_WESTERN = 'The quick brown fox jumps over the lazy dog';
const SAMPLE_CODE = 'fn => x != 0 && y <= 1 // 0O 1lI';

/** 卡片缩略与预览行：按字体的文字类型与是否等宽选择样例。 */
function samples(script: FontScript, monospace: boolean) {
  if (monospace && script === 'western') return { glyph: '{}', aside: '=>', line: SAMPLE_CODE };
  if (script === 'western') return { glyph: 'A', aside: 'g', line: SAMPLE_WESTERN };
  return { glyph: '永', aside: 'Aa', line: SAMPLE_ZH };
}

function coverageRatio(
  needle: readonly number[] | undefined,
  coverage: readonly number[],
): number | null {
  if (needle === undefined || needle.length === 0) return null;
  return intersectSorted(needle, coverage).length / needle.length;
}

function blockRatio(inspection: FontInspection, ids: readonly string[]): number {
  const blocks = inspection.blockCoverage.filter((block) => ids.includes(block.id));
  const covered = blocks.reduce((total, block) => total + block.covered, 0);
  return covered === 0 ? 0 : 1;
}

function CoverageBadges({
  inspection,
  script,
}: {
  readonly inspection: FontInspection;
  readonly script: FontScript;
}) {
  const { text } = usePreferences();
  const presets = useAppState((state) => state.data.presets);
  const items = useMemo(
    () =>
      script === 'western'
        ? [
            {
              label: text('拉丁', 'Latin'),
              title: text('拉丁-1 补充', 'Latin-1 Supplement'),
              ratio: blockRatio(inspection, ['latin-1-supplement']),
            },
            {
              label: text('拉丁扩展', 'Latin Ext'),
              title: text('拉丁扩展 A/B 与越南文', 'Latin Extended A/B and Vietnamese'),
              ratio: blockRatio(inspection, [
                'latin-extended-a',
                'latin-extended-b',
                'latin-extended-additional',
              ]),
            },
            {
              label: text('希腊', 'Greek'),
              title: text('希腊文', 'Greek and Coptic'),
              ratio: blockRatio(inspection, ['greek-and-coptic']),
            },
            {
              label: text('西里尔', 'Cyrillic'),
              title: text('西里尔文', 'Cyrillic'),
              ratio: blockRatio(inspection, ['cyrillic']),
            },
            {
              label: text('制表符', 'Box'),
              title: text('制表符与方块元素', 'Box drawing and block elements'),
              ratio: blockRatio(inspection, ['box-drawing', 'block-elements']),
            },
            {
              label: text('图标', 'Icons'),
              title: text(
                '私用区字形（如 Powerline、Nerd Font 图标）',
                'Private use glyphs (e.g. Powerline, Nerd Font icons)',
              ),
              ratio: blockRatio(inspection, [
                'private-use-area',
                'supplementary-private-use-area-a',
                'supplementary-private-use-area-b',
              ]),
            },
          ]
        : [
            {
              label: text('简体', 'SC'),
              title: text(
                '《通用规范汉字表》8105 字',
                'Table of General Chinese Characters (8,105)',
              ),
              ratio: coverageRatio(presets.get('sc-tgh-full')?.codePoints, inspection.coverage),
            },
            {
              label: text('繁体', 'TC'),
              title: text('教育部常用國字 4808 字', 'MOE common characters (4,808)'),
              ratio: coverageRatio(presets.get('tc-moe-common')?.codePoints, inspection.coverage),
            },
            {
              label: text('假名', 'Kana'),
              title: text('平假名与片假名', 'Hiragana and katakana'),
              ratio: blockRatio(inspection, ['hiragana', 'katakana']),
            },
            {
              label: text('韩文', 'Hangul'),
              title: text('谚文音节', 'Hangul syllables'),
              ratio: blockRatio(inspection, ['hangul-syllables']),
            },
          ],
    [inspection, presets, script, text],
  );
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={text('字符覆盖', 'Coverage')}>
      {items.map((item) => {
        const pending = item.ratio === null;
        const full = item.ratio !== null && item.ratio >= 0.995;
        const none = item.ratio !== null && item.ratio === 0;
        return (
          <li
            className={cx(
              'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[12px] font-medium tabular',
              none
                ? 'bg-hover text-fg-2 line-through decoration-fg-3/70'
                : full
                  ? 'bg-ok-soft text-ok'
                  : 'bg-hover text-fg-2',
            )}
            key={item.label}
            title={item.title}
          >
            {full ? <Check className="size-3" strokeWidth={3} /> : null}
            {item.label}
            {pending ? (
              <span className="text-fg-3">…</span>
            ) : !full && !none && item.ratio !== null ? (
              <span className="text-fg-3">{formatPercent(item.ratio, 0)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MetaRow({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: string;
  readonly href?: string;
}) {
  if (value.trim().length === 0) return null;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 py-1.5 text-[13px]">
      <dt className="text-fg-3">{label}</dt>
      <dd className="min-w-0 break-words text-fg-2">
        {href !== undefined && isExternalHttpUrl(href) ? (
          <a
            className="focus-ring rounded text-accent underline-offset-2 hover:underline"
            href={href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function FaceSettings({
  font,
  inspection,
  draft,
}: {
  readonly font: FontEntry;
  readonly inspection: FontInspection;
  readonly draft: FaceDraft;
}) {
  const { text } = usePreferences();
  const controller = useController();
  const running = useAppState((state) => state.run.phase === 'running');
  const id = useId();
  const instances = useMemo(
    () => selectableVariationInstances(inspection.variationAxes, inspection.variationInstances),
    [inspection],
  );
  const variable = inspection.variationAxes.length > 0;
  const autoPrefix = filePrefixFor('', draft.family.trim(), inspection.postScriptName);
  const customPrefix = draft.filePrefix.trim();
  const prefixInvalid = customPrefix.length > 0 && !isValidFilePrefix(customPrefix);
  const sampleName = useAppState((state) => {
    const output = selectExportPlan(state)?.outputs.find((item) => item.sourceId === font.id);
    const shard = output?.shards.at(-1);
    return output === undefined || shard === undefined
      ? null
      : shardFileName(output, shard.key, 'f73f604a');
  });
  return (
    <div className="grid content-start gap-4">
      <Field
        htmlFor={`${id}-family`}
        label={text('CSS 字族名', 'CSS family')}
        hint={text('同名字体会一起改名', 'Applies to every face of this family')}
      >
        <input
          className={inputClass}
          disabled={running}
          id={`${id}-family`}
          onChange={(event) => {
            controller.renameFamily(inspection.family, event.target.value);
          }}
          value={draft.family}
        />
      </Field>
      <Field
        error={
          prefixInvalid
            ? text(
                '只能用字母、数字和 . _ -，且以字母或数字开头结尾',
                'Letters, digits and . _ - only, starting and ending with a letter or digit',
              )
            : null
        }
        hint={
          sampleName === null
            ? text('留空时由字族名生成', 'Derived from the family name when empty')
            : text(`文件名示例：${sampleName}`, `Example: ${sampleName}`)
        }
        htmlFor={`${id}-prefix`}
        label={text('文件名前缀', 'File name prefix')}
      >
        <input
          aria-invalid={prefixInvalid}
          className={cx(inputClass, 'font-mono text-[13px]')}
          disabled={running}
          id={`${id}-prefix`}
          maxLength={64}
          onChange={(event) => {
            controller.setFilePrefix(inspection.family, event.target.value);
          }}
          placeholder={autoPrefix}
          spellCheck={false}
          value={draft.filePrefix}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field htmlFor={`${id}-weight`} label={text('字重', 'Weight')}>
          <input
            className={cx(inputClass, 'tabular')}
            disabled={
              running ||
              (variable &&
                draft.variationMode === 'preserve' &&
                inspection.variationAxes.some((axis) => axis.tag === 'wght'))
            }
            id={`${id}-weight`}
            inputMode="numeric"
            max={1000}
            min={1}
            onChange={(event) => {
              controller.updateDraft(font.id, { weight: Number(event.target.value) });
            }}
            type="number"
            value={draft.weight}
          />
        </Field>
        <Field htmlFor={`${id}-style`} label={text('样式', 'Style')}>
          <select
            className={inputClass}
            disabled={running}
            id={`${id}-style`}
            onChange={(event) => {
              controller.updateDraft(font.id, { style: event.target.value as FontStyle });
            }}
            value={draft.style}
          >
            <option value="normal">normal</option>
            <option value="italic">italic</option>
            <option value="oblique">oblique</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-fg-2">
        <input
          checked={draft.included}
          className="focus-ring size-4 accent-[var(--c-accent)]"
          disabled={running}
          onChange={(event) => {
            controller.updateDraft(font.id, { included: event.target.checked });
          }}
          type="checkbox"
        />
        {text('包含在输出中', 'Include in output')}
      </label>
      {variable ? (
        <div className="grid gap-3 rounded-lg border border-line bg-inset p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-fg-2">
              {text('可变轴', 'Axes')}{' '}
              {inspection.variationAxes.map((axis) => (
                <span className="ml-1 font-mono text-[12px] text-fg" key={axis.tag}>
                  {axis.tag} {axis.minValue}–{axis.maxValue}
                </span>
              ))}
            </p>
            <Segmented
              disabled={running}
              label={text('可变字体输出方式', 'Variable output')}
              onChange={(value) => {
                controller.updateDraft(font.id, {
                  variationMode: value,
                  instanceIds:
                    value === 'static' && draft.instanceIds.length === 0
                      ? instances
                          .filter((instance) => instance.isDefault)
                          .map((instance) => instance.id)
                      : draft.instanceIds,
                });
              }}
              options={[
                { value: 'preserve', label: text('保留可变', 'Keep variable') },
                { value: 'static', label: text('固定款式', 'Static instances') },
              ]}
              size="sm"
              value={draft.variationMode}
            />
          </div>
          {draft.variationMode === 'static' ? (
            <div className="flex flex-wrap gap-1.5">
              {instances.map((instance) => (
                <Chip
                  disabled={running}
                  key={instance.id}
                  onClick={() => {
                    const selected = new Set(draft.instanceIds);
                    if (selected.has(instance.id)) selected.delete(instance.id);
                    else selected.add(instance.id);
                    controller.updateDraft(font.id, { instanceIds: [...selected] });
                  }}
                  pressed={draft.instanceIds.includes(instance.id)}
                >
                  {instance.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-[13px] leading-5 text-fg-3">
              {text(
                '保留全部轴，输出一套可连续调节字重的分片。只用少数字重时，固定款式通常能再小 40% 左右。',
                'Keeps every axis in one set of shards. If you only use a few weights, static instances are usually around 40% smaller.',
              )}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReadyCard({
  font,
  inspection,
}: {
  readonly font: FontEntry;
  readonly inspection: FontInspection;
}) {
  const { text, locale } = usePreferences();
  const controller = useController();
  const running = useAppState((state) => state.run.phase === 'running');
  const family = usePreviewFamily(font.id);
  const draft = font.draft;
  const fontStyle =
    family === null ? undefined : { fontFamily: `"${family}", ui-sans-serif, sans-serif` };
  const variable = inspection.variationAxes.length > 0;
  const excluded = draft !== null && !draft.included;
  const webFeatures = useAppState((state) => state.output.cjkFeatures);
  const script = useMemo(() => classifyFontScript(inspection.coverage), [inspection]);
  const sample = samples(script, inspection.monospace);

  return (
    <article
      aria-label={inspection.fullName}
      className={cx(
        'animate-enter rounded-lg border border-line bg-surface transition-opacity',
        excluded && 'opacity-60',
      )}
    >
      <div className="flex gap-4 p-4">
        <div
          aria-hidden="true"
          className="relative grid h-[76px] w-[92px] shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-inset"
        >
          {family === null ? (
            <span className="skeleton h-full w-full" />
          ) : (
            <span className="text-[34px] leading-none text-fg" style={fontStyle}>
              {sample.glyph}
              <span className="text-[26px] text-fg-2">{sample.aside}</span>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-[15px] font-semibold text-fg"
                title={inspection.fullName}
              >
                {draft?.family ?? inspection.family}
                {variable ? null : (
                  <span className="ml-2 font-normal text-fg-3">{inspection.subfamily}</span>
                )}
              </h3>
              <p className="mt-0.5 truncate text-[12.5px] text-fg-3 tabular" title={font.file.name}>
                {font.file.name} · {formatLabel(inspection.format)} ·{' '}
                {formatBytes(inspection.sourceSize)} ·{' '}
                {text(
                  `${formatNumber(inspection.glyphCount, locale)} 字形`,
                  `${formatNumber(inspection.glyphCount, locale)} glyphs`,
                )}
              </p>
            </div>
            <IconButton
              disabled={running}
              label={text(`移除 ${font.file.name}`, `Remove ${font.file.name}`)}
              onClick={() => {
                controller.removeFont(font.id);
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {variable ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 text-[12px] font-medium text-accent tabular">
                {text('可变', 'Variable')}
                <span className="font-mono font-normal">
                  {inspection.variationAxes
                    .map((axis) => `${axis.tag} ${String(axis.minValue)}–${String(axis.maxValue)}`)
                    .join(' · ')}
                </span>
              </span>
            ) : null}
            {inspection.monospace ? (
              <span className="inline-flex h-6 items-center rounded-md border border-accent/30 bg-accent-soft px-2 text-[12px] font-medium text-accent">
                {text('等宽', 'Monospace')}
              </span>
            ) : null}
            <CoverageBadges inspection={inspection} script={script} />
          </div>
        </div>
      </div>
      {family !== null ? (
        <p
          aria-hidden="true"
          className="truncate border-t border-line px-4 py-2.5 text-[20px] text-fg"
          style={fontStyle}
        >
          {sample.line}
          {script === 'cjk' ? <span className="text-fg-2"> {SAMPLE_LATIN}</span> : null}
        </p>
      ) : null}
      <div className="border-t border-line px-4 py-1.5">
        <Disclosure
          aside={
            inspection.warnings.length > 0
              ? text(
                  `${String(inspection.warnings.length)} 条提示`,
                  `${String(inspection.warnings.length)} note(s)`,
                )
              : undefined
          }
          summary={text('字体信息与输出设置', 'Details & output settings')}
        >
          <div className="grid gap-5 pb-3 lg:grid-cols-2">
            <div>
              {inspection.warnings.length > 0 ? (
                <ul className="mb-3 grid gap-1.5">
                  {inspection.warnings.map((warning) => (
                    <li className="flex items-start gap-2 text-[13px] text-warn" key={warning.code}>
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {describeWarning(warning, text)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <dl className="divide-y divide-line">
                <MetaRow label="PostScript" value={inspection.postScriptName} />
                <MetaRow label={text('版本', 'Version')} value={inspection.version} />
                <MetaRow label={text('设计', 'Designer')} value={inspection.designer} />
                <MetaRow label={text('厂商', 'Foundry')} value={inspection.manufacturer} />
                <MetaRow label={text('版权', 'Copyright')} value={inspection.copyright} />
                <MetaRow
                  href={inspection.licenseUrl}
                  label={text('许可', 'License')}
                  value={inspection.license || inspection.licenseUrl}
                />
                <MetaRow
                  label={text('字符', 'Characters')}
                  value={text(
                    `${formatNumber(inspection.coverage.length, locale)} 个码点`,
                    `${formatNumber(inspection.coverage.length, locale)} code points`,
                  )}
                />
              </dl>
              {inspection.layoutFeatures.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-[13px] text-fg-3">
                    {text('排版特性', 'Layout features')}
                    <span className="ml-1.5">
                      {text('高亮为生成后保留', 'highlighted ones are kept')}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {inspection.layoutFeatures.map((feature) => (
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5 font-mono text-[11.5px]',
                          isRetainedLayoutFeature(feature, webFeatures)
                            ? 'bg-accent-soft text-accent'
                            : 'bg-hover text-fg-3',
                        )}
                        key={feature}
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {draft === null ? null : (
              <FaceSettings draft={draft} font={font} inspection={inspection} />
            )}
          </div>
        </Disclosure>
      </div>
    </article>
  );
}

export function FontCard({ font }: { readonly font: FontEntry }) {
  const { text } = usePreferences();
  const controller = useController();
  if (font.status === 'ready' && font.inspection !== null) {
    return <ReadyCard font={font} inspection={font.inspection} />;
  }
  if (font.status === 'error') {
    return (
      <article
        className="animate-enter flex items-start gap-3 rounded-lg border border-danger/40 bg-danger-soft p-4"
        role="alert"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{font.file.name}</p>
          <p className="mt-0.5 text-[13px] text-danger">
            {localizeEngineError(font.error ?? '', text)}
          </p>
        </div>
        <IconButton
          label={text('重试', 'Retry')}
          onClick={() => {
            controller.retryFont(font.id);
          }}
        >
          <RotateCw className="size-4" />
        </IconButton>
        <IconButton
          label={text(`移除 ${font.file.name}`, `Remove ${font.file.name}`)}
          onClick={() => {
            controller.removeFont(font.id);
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </article>
    );
  }
  return (
    <article aria-busy="true" className="flex gap-4 rounded-lg border border-line bg-surface p-4">
      <div className="skeleton h-[76px] w-[92px] shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-fg">{font.file.name}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-fg-3">
          <LoaderCircle className="size-3.5 animate-spin" />
          {font.status === 'inspecting'
            ? text('正在分析字形与体积…', 'Analyzing glyphs and sizes…')
            : text('等待分析', 'Waiting')}
          <span className="tabular">· {formatBytes(font.file.size)}</span>
        </p>
        <div className="mt-3 flex gap-1.5">
          {[48, 40, 44, 52].map((width, index) => (
            <span className="skeleton h-6 rounded-md" key={index} style={{ width }} />
          ))}
        </div>
      </div>
    </article>
  );
}
