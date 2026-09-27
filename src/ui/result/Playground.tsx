import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatFontNumericDescriptor } from '../../core/css-gen';
import { defaultPreviewText, type GeneratedOutput } from '../../core/output-package';
import type { RunResult } from '../../app/state';
import { usePreferences } from '../../i18n/preferences';
import { useServices, type ShardPreviewHandle } from '../app-context';
import { formatBytes, formatNumber } from '../format';
import { Segmented, Slider } from '../primitives';
import { cx } from '../utils';

const DEFAULT_TEXT_ZH =
  '人生若只如初见，何事秋风悲画扇。等闲变却故人心，却道故人心易变。\n在这里输入或粘贴任意文字：浏览器只会请求它真正需要的分片，与部署到网站后完全一致。';
const DEFAULT_TEXT_EN =
  '人生若只如初见，何事秋风悲画扇。等闲变却故人心，却道故人心易变。\nType or paste anything here. The browser requests only the shards this text needs, exactly as it will on your site.';

function defaultText(result: RunResult, locale: 'zh-CN' | 'en'): string {
  const context = result.context;
  if (context.characters.script === 'cjk' && !(context.outputs[0]?.monospace ?? false)) {
    return locale === 'en' ? DEFAULT_TEXT_EN : DEFAULT_TEXT_ZH;
  }
  return defaultPreviewText(
    context.characters.script,
    context.outputs[0]?.monospace ?? false,
    locale,
  );
}

function faceLabel(output: GeneratedOutput): string {
  const style = output.style === 'normal' ? '' : ` ${output.style}`;
  return `${formatFontNumericDescriptor(output.weight)}${style}${output.variationMode === 'static' ? ` · ${output.instanceName}` : ''}`;
}

function usePreviewSet(result: RunResult): ShardPreviewHandle {
  const { platform } = useServices();
  const preview = useMemo(
    () =>
      platform.createShardPreview(
        result.context.outputs.map((output) => ({
          weight: output.weight,
          ...(output.stretch === undefined ? {} : { stretch: output.stretch }),
          style: output.style,
          shards: output.shards.flatMap((shard) => {
            const data = result.shardData.get(shard.fileName);
            return data === undefined
              ? []
              : [{ id: `${output.id}|${shard.key}`, data, codePoints: shard.codePoints }];
          }),
        })),
      ),
    [platform, result],
  );
  useEffect(() => {
    preview.attach();
    return () => {
      preview.detach();
    };
  }, [preview]);
  return preview;
}

export function Playground({
  result,
  initialText,
}: {
  readonly result: RunResult;
  readonly initialText: string;
}) {
  const { text, locale } = usePreferences();
  const outputs = result.context.outputs;
  const [value, setValue] = useState(() =>
    initialText.trim().length > 0 ? initialText.slice(0, 4000) : defaultText(result, locale),
  );
  const [faceIndex, setFaceIndex] = useState(0);
  const face = outputs[Math.min(faceIndex, outputs.length - 1)] ?? outputs[0];
  const code = face?.monospace ?? false;
  const [size, setSize] = useState(code ? 16 : 28);
  const preview = usePreviewSet(result);

  const requested = useSyncExternalStore(
    (listener) => preview.subscribe(listener),
    () => [...preview.requestedIds()].sort().join(','),
  );

  const covered = useMemo(() => {
    const set = new Set<number>();
    if (face !== undefined)
      for (const shard of face.shards) for (const codePoint of shard.codePoints) set.add(codePoint);
    return set;
  }, [face]);

  const segments = useMemo(() => {
    const parts: { text: string; missing: boolean }[] = [];
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      const missing = !/\s/u.test(character) && !covered.has(codePoint);
      const last = parts.at(-1);
      if (last?.missing === missing) last.text += character;
      else parts.push({ text: character, missing });
    }
    return parts;
  }, [covered, value]);
  const missingChars = useMemo(
    () => [
      ...new Set(segments.filter((part) => part.missing).flatMap((part) => Array.from(part.text))),
    ],
    [segments],
  );

  const loaded = useMemo(() => {
    const ids = new Set(requested.split(',').filter(Boolean));
    const list: { key: string; bytes: number; chars: number }[] = [];
    for (const output of outputs) {
      for (const shard of output.shards) {
        if (ids.has(`${output.id}|${shard.key}`)) {
          list.push({
            key: outputs.length > 1 ? `${faceLabel(output)} #${shard.key}` : shard.key,
            bytes: shard.bytes,
            chars: shard.codePoints.length,
          });
        }
      }
    }
    return list;
  }, [outputs, requested]);
  const loadedBytes = loaded.reduce((sum, item) => sum + item.bytes, 0);

  if (face === undefined) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {outputs.length > 1 ? (
            <Segmented
              label={text('款式', 'Face')}
              onChange={(next) => {
                setFaceIndex(Number(next));
              }}
              options={outputs.map((output, index) => ({
                value: String(index),
                label: faceLabel(output),
              }))}
              size="sm"
              value={String(faceIndex)}
            />
          ) : null}
          <div className="flex min-w-48 flex-1 items-center gap-2 text-[12px] whitespace-nowrap text-fg-3">
            {text('字号', 'Size')}
            <Slider
              label={text('预览字号', 'Preview size')}
              max={72}
              min={14}
              onChange={setSize}
              value={size}
            />
            <span className="w-8 tabular">{size}px</span>
          </div>
        </div>
        <textarea
          aria-label={text('预览文字', 'Preview text')}
          className="focus-ring scrollbar-thin min-h-20 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[13px] leading-6 text-fg-2"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          spellCheck={false}
          value={value}
        />
        <div
          aria-live="off"
          className={cx(
            'scrollbar-thin max-h-[360px] min-h-40 overflow-auto rounded-lg border border-line bg-inset px-5 py-4 text-fg',
            code ? 'whitespace-pre' : 'whitespace-pre-wrap',
          )}
          lang={result.context.characters.script === 'cjk' ? 'zh' : undefined}
          style={{
            fontFamily: `"${preview.family}", ui-sans-serif, sans-serif`,
            fontWeight: typeof face.weight === 'number' ? face.weight : 400,
            fontStyle: face.style,
            fontSize: size,
            lineHeight: 1.6,
          }}
        >
          {segments.map((part, index) => (
            <span
              className={cx(
                part.missing &&
                  'rounded-sm bg-danger-soft text-danger underline decoration-wavy decoration-danger/70 underline-offset-4',
              )}
              key={index}
              title={
                part.missing
                  ? text(
                      '不在任何分片中，网页字体不会显示这个字',
                      'Not in any shard; the web font will not render it',
                    )
                  : undefined
              }
            >
              {part.text}
            </span>
          ))}
        </div>
        {missingChars.length > 0 ? (
          <p className="text-[13px] text-danger">
            {text(
              `${String(missingChars.length)} 个字不在分片中：`,
              `${String(missingChars.length)} characters are not in any shard: `,
            )}
            <span className="tracking-widest">{missingChars.slice(0, 40).join('')}</span>
          </p>
        ) : null}
      </div>
      <aside className="grid content-start gap-2 rounded-lg border border-line bg-surface p-4">
        <p className="text-[12px] text-fg-3">{text('浏览器实际请求', 'Actually requested')}</p>
        <p className="text-[24px] font-semibold tracking-tight tabular">
          {formatBytes(loadedBytes)}
        </p>
        <p className="text-[12px] text-fg-3 tabular">
          {text(
            `${String(loaded.length)} / ${formatNumber(
              outputs.reduce((sum, output) => sum + output.shards.length, 0),
              locale,
            )} 个文件`,
            `${String(loaded.length)} of ${formatNumber(
              outputs.reduce((sum, output) => sum + output.shards.length, 0),
              locale,
            )} files`,
          )}
        </p>
        <ol className="scrollbar-thin mt-2 grid max-h-64 gap-1 overflow-auto">
          {loaded.map((item) => (
            <li
              className="animate-enter flex items-center justify-between gap-2 rounded-md bg-accent-soft px-2 py-1 font-mono text-[12px] text-fg-2"
              key={item.key}
            >
              <span className="truncate">{item.key}</span>
              <span className="shrink-0 tabular">{formatBytes(item.bytes)}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
