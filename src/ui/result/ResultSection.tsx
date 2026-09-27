import { AlertTriangle, Download, FileCode2, FolderDown, LoaderCircle } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  FONT_DISPLAY_VALUES,
  formatFontNumericDescriptor,
  validateUrlPrefix,
  type CssFontDisplay,
} from '../../core/css-gen';
import { profileMetrics } from '../../core/plan-metrics';
import { shardLoadProbability, DESIGN_PAGE_TOKENS } from '../../core/shard-planner';
import { selectInputKey } from '../../app/derive';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController, useServices } from '../app-context';
import { charFor, formatBytes, formatDuration, formatNumber, formatPercent } from '../format';
import { localizeEngineError } from '../messages';
import { Button, CodeBlock, Disclosure, Field, Segmented } from '../primitives';
import { shallowEqual } from '../use-store';
import { cx, inputClass } from '../utils';
import { Playground } from './Playground';

type Tab = 'quick' | 'css' | 'readme' | 'report';

function Stat({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-[12px] text-fg-3">{label}</p>
      <p className="mt-0.5 truncate text-[20px] font-semibold tracking-tight tabular">{value}</p>
      {detail === undefined ? null : (
        <p className="truncate text-[12px] text-fg-3 tabular">{detail}</p>
      )}
    </div>
  );
}

/** 只影响 CSS 文本的设置：改动后代码与 ZIP 即时更新，不需要重新生成。 */
function IntegrationSettings({ prefixError }: { readonly prefixError: string | null }) {
  const { text } = usePreferences();
  const controller = useController();
  const output = useAppState(
    (state) => ({
      urlPrefix: state.output.urlPrefix,
      fontDisplay: state.output.fontDisplay,
    }),
    shallowEqual,
  );
  const id = useId();
  const displayHints: Record<CssFontDisplay, string> = {
    swap: text('加载前先显示其他字体，加载后替换', 'Show other fonts first, swap when loaded'),
    fallback: text('短暂等待，超时后不再替换', 'Brief wait, then stop swapping'),
    optional: text('只在极快时使用网页字体', 'Use the web font only if nearly instant'),
    block: text('等待字体加载，期间文字不可见', 'Hide text until loaded'),
    auto: text('由浏览器决定', 'Browser decides'),
  };
  return (
    <div className="grid gap-4 rounded-lg border border-line bg-inset/60 p-4">
      <Field
        error={prefixError === null ? null : localizeEngineError(prefixError, text)}
        hint={text(
          '字体文件在网站上的位置。留空时 CSS 引用同目录下的 ./fonts/',
          'Where the font files live on your site. Empty means ./fonts/ next to the CSS',
        )}
        htmlFor={`${id}-prefix`}
        label={text('字体路径', 'Font path')}
      >
        <input
          aria-invalid={prefixError !== null}
          className={cx(inputClass, 'font-mono text-[13px]')}
          id={`${id}-prefix`}
          onChange={(event) => {
            controller.updateOutput({ urlPrefix: event.target.value });
          }}
          placeholder="/assets/fonts"
          spellCheck={false}
          value={output.urlPrefix}
        />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">font-display</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Segmented
            label="font-display"
            onChange={(fontDisplay) => {
              controller.updateOutput({ fontDisplay });
            }}
            options={FONT_DISPLAY_VALUES.map((value) => ({
              value,
              label: value,
              hint: displayHints[value],
            }))}
            size="sm"
            value={output.fontDisplay}
          />
          <span className="text-[12.5px] text-fg-3">{displayHints[output.fontDisplay]}</span>
        </div>
      </div>
    </div>
  );
}

export function ResultSection() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const { platform } = useServices();
  const result = useAppState((state) => state.run.result);
  const inputKey = useAppState(selectInputKey);
  const customText = useAppState((state) => state.characters.customText);
  const textSettings = useAppState(
    (state) => ({
      urlPrefix: state.output.urlPrefix,
      fontDisplay: state.output.fontDisplay,
    }),
    shallowEqual,
  );
  const [tab, setTab] = useState<Tab>('quick');
  const [busy, setBusy] = useState<'zip' | 'folder' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  let prefixError: string | null = null;
  try {
    validateUrlPrefix(textSettings.urlPrefix);
  } catch (error: unknown) {
    prefixError = error instanceof Error ? error.message : String(error);
  }

  const pack = useMemo(
    () => (result === null ? null : controller.resultPackage(result, locale, textSettings)),
    [controller, locale, result, textSettings],
  );
  if (result === null || pack === null) return null;

  const context = result.context;
  const stale = result.inputKey !== inputKey;
  const totalBytes = context.outputs.reduce((sum, output) => sum + output.metrics.totalBytes, 0);
  const shardCount = context.outputs.reduce((sum, output) => sum + output.shards.length, 0);
  const primary = context.outputs[0];
  const article = primary === undefined ? null : profileMetrics(primary.metrics, 'article');
  const cssHref = textSettings.urlPrefix.trim().length > 0 ? '/fonts.css' : '/fonts/fonts.css';
  const quickStart = `<!-- ${text('放进 <head>', 'In <head>')} -->\n${pack.texts.preloadHtml}${pack.texts.preloadHtml ? '\n' : ''}<link rel="stylesheet" href="${cssHref}">\n\n/* CSS */\n${pack.texts.usageCss}`;

  const run = async (kind: 'zip' | 'folder') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'zip') {
        const zip = await platform.buildZip(pack.files);
        platform.downloadBytes(pack.texts.zipName, zip, 'application/zip');
      } else {
        const name = await platform.writeToDirectory(pack.files);
        setMessage({
          kind: 'ok',
          text: text(
            `已写入 ${name}/（fonts.css 与 fonts/ 目录）`,
            `Written to ${name}/ (fonts.css and fonts/)`,
          ),
        });
      }
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessage({
          kind: 'error',
          text: localizeEngineError(error instanceof Error ? error.message : String(error), text),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="result-heading"
      className="mx-auto max-w-[1400px] scroll-mt-20 px-4 pb-10 sm:px-6"
      id="result"
    >
      <div
        className={cx(
          'rounded-xl border bg-surface shadow-card transition-opacity',
          stale ? 'border-warn/40' : 'border-line',
        )}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 font-mono text-[12px] font-medium tracking-wider text-accent"
            >
              03
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight" id="result-heading">
                {text('结果', 'Result')}
              </h2>
              <p className="mt-0.5 text-[13px] text-fg-3">
                {text(
                  `${new Date(context.generatedAt).toLocaleString('zh-CN')} · 用时 ${formatDuration(context.elapsedMs, locale)} · ${String(context.threads)} 线程`,
                  `${new Date(context.generatedAt).toLocaleString('en-US')} · ${formatDuration(context.elapsedMs, locale)} · ${String(context.threads)} threads`,
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {platform.canWriteDirectory() ? (
              <Button
                disabled={busy !== null}
                icon={
                  busy === 'folder' ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <FolderDown className="size-4" />
                  )
                }
                onClick={() => {
                  void run('folder');
                }}
              >
                {text('写入项目文件夹', 'Write to folder')}
              </Button>
            ) : null}
            <Button
              disabled={busy !== null}
              icon={
                busy === 'zip' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )
              }
              onClick={() => {
                void run('zip');
              }}
              variant="primary"
            >
              {text('下载 ZIP', 'Download ZIP')}
            </Button>
          </div>
        </header>

        <div className="grid gap-6 px-5 py-5 sm:px-6">
          {stale ? (
            <p
              className="flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-[13px] text-warn"
              role="status"
            >
              <AlertTriangle className="size-4 shrink-0" />
              {text(
                '设置已更改，这份结果对应上一次生成。在分包预览中按新设置重新生成。',
                'Settings changed since this result was generated. Regenerate from the plan preview.',
              )}
            </p>
          ) : null}
          {message === null ? null : (
            <p
              className={cx(
                'rounded-lg px-3 py-2.5 text-[13px]',
                message.kind === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
              )}
              role={message.kind === 'ok' ? 'status' : 'alert'}
            >
              {message.text}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              detail={
                context.totalSourceBytes > 0
                  ? text(
                      `原字体 ${formatBytes(context.totalSourceBytes)}`,
                      `source ${formatBytes(context.totalSourceBytes)}`,
                    )
                  : undefined
              }
              label={text('全部文件', 'All files')}
              value={formatBytes(totalBytes)}
            />
            <Stat
              detail={text(
                `${String(context.outputs.length)} 个款式`,
                `${String(context.outputs.length)} face(s)`,
              )}
              label={text('文件数', 'Files')}
              value={formatNumber(shardCount, locale)}
            />
            <Stat
              detail={
                article === null
                  ? undefined
                  : text(
                      `${article.expectedRequests.toFixed(1)} 个文件`,
                      `${article.expectedRequests.toFixed(1)} files`,
                    )
              }
              label={text('文章页首访', 'Article page')}
              value={article === null ? '—' : formatBytes(article.expectedBytes)}
            />
            <Stat
              detail={
                primary === undefined
                  ? undefined
                  : text(
                      `缺 ${formatNumber(primary.missing.length, locale)} 字`,
                      `${formatNumber(primary.missing.length, locale)} missing`,
                    )
              }
              label={text('已包含字符', 'Characters')}
              value={primary === undefined ? '—' : formatNumber(primary.availableCount, locale)}
            />
          </div>

          <div>
            <h3 className="mb-1 text-[13px] font-medium text-fg-2">{text('试一试', 'Try it')}</h3>
            <p className="mb-3 text-[12.5px] text-fg-3">
              {text(
                '在这里输入任意文字，浏览器只会请求它真正需要的分片，与部署到网站后完全一致。',
                'Type anything: the browser requests only the shards this text needs, exactly as on your site.',
              )}
            </p>
            <Playground initialText={customText} result={result} />
          </div>

          <div>
            <h3 className="mb-1 text-[13px] font-medium text-fg-2">
              {text('接入设置', 'Integration settings')}
            </h3>
            <p className="mb-3 text-[12.5px] text-fg-3">
              {text(
                '只影响 CSS，改动后下面的代码与 ZIP 立即更新。',
                'Only affect the CSS; the code and ZIP below update immediately.',
              )}
            </p>
            <IntegrationSettings prefixError={prefixError} />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-medium text-fg-2">
                {text('接入代码', 'Integration code')}
              </h3>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Segmented
                  label={text('代码', 'Code')}
                  onChange={setTab}
                  options={[
                    { value: 'quick', label: text('快速接入', 'Quick start') },
                    { value: 'css', label: 'fonts.css' },
                    { value: 'readme', label: 'README' },
                    { value: 'report', label: 'report.json' },
                  ]}
                  size="sm"
                  value={tab}
                />
                <Button
                  icon={<FileCode2 className="size-3.5" />}
                  onClick={() => {
                    platform.downloadBytes('fonts.css', pack.texts.css, 'text/css');
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {text('下载 CSS', 'CSS')}
                </Button>
              </div>
            </div>
            {tab === 'quick' ? (
              <div className="grid gap-2">
                <CodeBlock
                  code={quickStart}
                  copy={platform.copyText}
                  label={text('接入代码', 'Integration code')}
                />
                <p className="text-[13px] text-fg-3">
                  {textSettings.urlPrefix.trim().length > 0
                    ? text(
                        `把 fonts/ 目录上传到 ${textSettings.urlPrefix}，fonts.css 放到网站根目录，或按实际位置修改上面的 href。`,
                        `Upload the fonts/ folder to ${textSettings.urlPrefix} and fonts.css to the site root, or edit the href above.`,
                      )
                    : text(
                        '把 fonts.css 与 fonts/ 目录一起放到网站的 /fonts/ 下；路径不同时在上方"字体路径"中设置。',
                        'Place fonts.css and the fonts/ folder together under /fonts/ on your site, or set Font path above.',
                      )}
                </p>
              </div>
            ) : tab === 'css' ? (
              <CodeBlock
                code={pack.texts.css}
                copy={platform.copyText}
                label="fonts.css"
                maxHeight={420}
              />
            ) : tab === 'readme' ? (
              <CodeBlock
                code={pack.texts.readme}
                copy={platform.copyText}
                label="README.md"
                maxHeight={420}
              />
            ) : (
              <CodeBlock
                code={pack.texts.reportJson}
                copy={platform.copyText}
                label="report.json"
                maxHeight={420}
              />
            )}
          </div>

          <Disclosure
            aside={text(`${String(shardCount)} 个文件`, `${String(shardCount)} files`)}
            summary={text('分片明细', 'Shard details')}
          >
            <div className="scrollbar-thin max-h-[480px] overflow-auto rounded-lg border border-line">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-inset text-fg-3">
                  <tr>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {text('文件', 'File')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium" scope="col">
                      {text('字数', 'Chars')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium" scope="col">
                      {text('体积', 'Size')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium" scope="col">
                      {text('预估', 'Est.')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium" scope="col">
                      {text('文章页加载', 'Load (article)')}
                    </th>
                    <th className="px-3 py-2 font-medium" scope="col">
                      {text('示例', 'Sample')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {context.outputs.flatMap((output) =>
                    output.shards.map((shard) => (
                      <tr className="hover:bg-hover/60" key={shard.fileName}>
                        <td
                          className="max-w-64 truncate px-3 py-1.5 font-mono text-fg-2"
                          title={shard.fileName}
                        >
                          {shard.preload ? (
                            <span
                              className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle"
                              title="preload"
                            />
                          ) : null}
                          {context.outputs.length > 1
                            ? `${formatFontNumericDescriptor(output.weight)} · `
                            : ''}
                          {shard.fileName}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">
                          {formatNumber(shard.codePoints.length, locale)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">
                          {formatBytes(shard.bytes)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-fg-3 tabular">
                          {formatBytes(shard.estimatedBytes)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">
                          {formatPercent(shardLoadProbability(shard, DESIGN_PAGE_TOKENS), 0)}
                        </td>
                        <td
                          className="max-w-48 truncate px-3 py-1.5 text-[14px] text-fg-2"
                          lang="zh"
                        >
                          {shard.codePoints.slice(0, 14).map(charFor).join('')}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </div>
      </div>
    </section>
  );
}
