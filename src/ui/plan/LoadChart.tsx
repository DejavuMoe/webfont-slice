import {
  memo,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { shardLoadProbability, type ShardKind } from '../../core/shard-planner';
import { usePreferences } from '../../i18n/preferences';
import { charFor, formatBytes, formatNumber, formatPercent } from '../format';
import { cx } from '../utils';

export interface ChartShard {
  readonly id: string;
  readonly key: string;
  readonly kind: ShardKind;
  readonly bytes: number;
  readonly mass: number;
  readonly preload: boolean;
  readonly codePoints: readonly number[];
}

interface Layout {
  readonly total: number;
  readonly bars: readonly {
    readonly shard: ChartShard;
    readonly x: number;
    readonly width: number;
    readonly p: number;
  }[];
}

function layout(shards: readonly ChartShard[], tokens: number): Layout {
  const total = shards.reduce((sum, shard) => sum + shard.bytes, 0);
  let cursor = 0;
  return {
    total,
    bars: shards.map((shard) => {
      const bar = { shard, x: cursor, width: shard.bytes, p: shardLoadProbability(shard, tokens) };
      cursor += shard.bytes;
      return bar;
    }),
  };
}

const HEIGHT = 1000;

const Bars = memo(function Bars({
  data,
  done,
  running,
  active,
}: {
  readonly data: Layout;
  readonly done: ReadonlySet<string> | null;
  readonly running: boolean;
  readonly active: number | null;
}) {
  const gap = data.total * 0.0018;
  return (
    <>
      {data.bars.map((bar, index) => {
        const height = Math.max(bar.p, 0.012) * HEIGHT;
        const pending = running && done !== null && !done.has(bar.shard.id);
        const dimmed = active !== null && active !== index;
        return (
          <rect
            className="transition-[opacity,height,y,x,width] duration-300 ease-[var(--ease-out)]"
            height={height}
            key={bar.shard.id}
            style={{
              fill: `color-mix(in oklch, var(--c-accent) ${String(Math.round(bar.p * 100))}%, var(--c-cold))`,
              opacity: pending ? 0.28 : dimmed ? 0.45 : 1,
            }}
            width={Math.max(bar.width - gap, data.total * 0.0012)}
            x={bar.x}
            y={HEIGHT - height}
          />
        );
      })}
    </>
  );
});

/**
 * 分片加载概率图：每根柱的宽度 ∝ 体积，高度 ∝ 在当前页面长度下被下载的概率。
 * 悬停或按方向键选中某片时，详情显示在图下方的固定信息条里，不会遮挡或溢出。
 */
export function LoadChart({
  shards,
  tokens,
  done,
  running,
  sampleFamily,
  measured,
}: {
  readonly shards: readonly ChartShard[];
  readonly tokens: number;
  readonly done: ReadonlySet<string> | null;
  readonly running: boolean;
  readonly sampleFamily: string | null;
  readonly measured: boolean;
}) {
  const { text, locale } = usePreferences();
  const data = useMemo(() => layout(shards, tokens), [shards, tokens]);
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const descriptionId = useId();

  const expected = data.bars.reduce((sum, bar) => sum + bar.p * bar.shard.bytes, 0);
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect === undefined || data.total === 0) return;
    const x = ((clientX - rect.left) / rect.width) * data.total;
    let low = 0;
    let high = data.bars.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((data.bars[middle]?.x ?? 0) <= x) low = middle;
      else high = middle - 1;
    }
    setActive(low);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (data.bars.length === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((current) =>
        Math.min(
          data.bars.length - 1,
          Math.max(0, (current ?? (step > 0 ? -1 : data.bars.length)) + step),
        ),
      );
    } else if (event.key === 'Home') {
      setActive(0);
    } else if (event.key === 'End') {
      setActive(data.bars.length - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };

  const bar = active === null ? null : (data.bars[active] ?? null);
  const kindLabel = (kind: ShardKind, key: string) =>
    kind === 'base'
      ? text('基础片', 'Base')
      : kind === 'single'
        ? text('单文件', 'Single file')
        : `#${key}`;

  return (
    <div className="grid gap-2">
      <div
        aria-describedby={descriptionId}
        aria-label={text(
          '分片加载概率图，方向键逐片查看',
          'Shard load chart; use arrow keys to inspect shards',
        )}
        className="focus-ring relative h-36 touch-none overflow-hidden rounded-md outline-none"
        onBlur={() => {
          setActive(null);
        }}
        onKeyDown={onKeyDown}
        onPointerCancel={() => {
          setActive(null);
        }}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          pick(event.clientX);
        }}
        onPointerLeave={() => {
          setActive(null);
        }}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'mouse' || event.buttons > 0) pick(event.clientX);
        }}
        ref={box}
        role="application"
        tabIndex={0}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-md border border-dashed border-line-strong"
          style={{
            backgroundImage:
              'repeating-linear-gradient(135deg, var(--c-grid) 0 1px, transparent 1px 7px)',
          }}
        />
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${String(Math.max(1, data.total))} ${String(HEIGHT)}`}
        >
          <Bars active={active} data={data} done={done} running={running} />
          {bar === null ? null : (
            <rect
              className="pointer-events-none"
              fill="none"
              height={HEIGHT}
              stroke="var(--c-fg)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              width={bar.width}
              x={bar.x}
              y={0}
            />
          )}
        </svg>
        {data.bars.map((item) =>
          item.shard.preload ? (
            <span
              aria-hidden="true"
              className="absolute top-1.5 size-1.5 -translate-x-1/2 rounded-full bg-accent-fg ring-2 ring-accent"
              key={item.shard.id}
              style={{ left: `${String(((item.x + item.width / 2) / data.total) * 100)}%` }}
            />
          ) : null,
        )}
      </div>

      <div
        aria-live="polite"
        className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-inset px-3 py-1.5 text-[12.5px] text-fg-3 tabular"
        id={descriptionId}
      >
        {bar === null ? (
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-3 shrink-0 rounded-sm"
                  style={{ background: 'linear-gradient(90deg, var(--c-accent), var(--c-cold))' }}
                />
                {text(`期望下载 ${formatBytes(expected)}`, `expected ${formatBytes(expected)}`)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-3 shrink-0 rounded-sm border border-dashed border-line-strong" />
                {text(`全部 ${formatBytes(data.total)}`, `all ${formatBytes(data.total)}`)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-accent-fg ring-2 ring-accent" />
                {text('预加载', 'preload')}
              </span>
            </span>
            <span className={cx('shrink-0', running && 'text-accent')}>
              {text(`${String(shards.length)} 片`, `${String(shards.length)} shards`)}
            </span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono font-medium text-fg">
                {kindLabel(bar.shard.kind, bar.shard.key)}
              </span>
              <span className="text-fg-2">
                {formatNumber(bar.shard.codePoints.length, locale)} {text('字', 'chars')}
              </span>
              <span className="text-fg-2">
                {formatBytes(bar.shard.bytes)}
                {measured ? '' : text('（预估）', ' est.')}
              </span>
              <span>
                {text('加载概率 ', 'load ')}
                <span className="font-medium text-fg">
                  {formatPercent(bar.p, bar.p > 0.995 || bar.p < 0.005 ? 0 : 1)}
                </span>
              </span>
              {bar.shard.preload ? (
                <span className="text-accent">{text('预加载', 'preload')}</span>
              ) : null}
            </span>
            <span
              className="min-w-0 max-w-[45%] shrink truncate text-[15px] text-fg"
              lang="zh"
              style={
                sampleFamily === null ? undefined : { fontFamily: `"${sampleFamily}", sans-serif` }
              }
            >
              {bar.shard.codePoints.slice(0, 18).map(charFor).join('')}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
