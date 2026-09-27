import { AlertCircle, ArrowDown, CheckCircle2, CircleSlash, Cpu, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { corpusCoverage } from '../../core/frequency';
import {
  evaluateShards,
  pageProfile,
  PAGE_PROFILES,
  profileMetrics,
  type PageProfileId,
} from '../../core/plan-metrics';
import { GRANULARITY_LEVELS } from '../../core/shard-planner';
import {
  selectBlockers,
  selectExportPlan,
  selectInputKey,
  selectFontScript,
  selectTextProfile,
} from '../../app/derive';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController } from '../app-context';
import { formatBytes, formatDuration, formatNumber, formatPercent } from '../format';
import { describeBlocker, describeIssue, localizeEngineError } from '../messages';
import { Button, Disclosure, IconButton, Kbd, Segmented, Slider, Switch } from '../primitives';
import { cx } from '../utils';
import { usePreviewFamily } from '../fonts/preview-context';
import { LoadChart, type ChartShard } from './LoadChart';

function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => {
      setNow(performance.now());
    }, 200);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

function Metric({
  label,
  value,
  detail,
  emphasis,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly emphasis?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd
        className={cx(
          'mt-0.5 tabular',
          emphasis
            ? 'text-[22px] font-semibold tracking-tight text-fg'
            : 'text-[15px] font-medium text-fg',
        )}
      >
        <span className="block truncate">{value}</span>
        {detail === undefined ? null : (
          <span className="block truncate text-[12px] leading-4 font-normal text-fg-3">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

function ShardingControls() {
  const { text } = usePreferences();
  const controller = useController();
  const plan = useAppState((state) => state.plan);
  const running = useAppState((state) => state.run.phase === 'running');
  const granularityLabel = (level: number) =>
    level <= 2
      ? text('最省流量', 'Fewest bytes')
      : level >= 6
        ? text('最少文件', 'Fewest files')
        : level === 4
          ? text('均衡', 'Balanced')
          : level < 4
            ? text('偏省流量', 'Leaning bytes')
            : text('偏少文件', 'Leaning files');
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-fg-2">{text('分包方式', 'Sharding')}</span>
        <Segmented
          disabled={running}
          label={text('分包方式', 'Sharding')}
          onChange={(strategy) => {
            controller.updatePlan({ strategy });
          }}
          options={[
            {
              value: 'smart',
              label: text('按需分片', 'On-demand shards'),
              hint: text('页面只下载用到的分片', 'Pages download only the shards they use'),
            },
            {
              value: 'single',
              label: text('单文件', 'Single file'),
              hint: text('全部字符打成一个文件', 'Everything in one file'),
            },
          ]}
          size="sm"
          value={plan.strategy}
        />
      </div>
      {plan.strategy === 'smart' ? (
        <div className="grid gap-1">
          <div className="flex items-center justify-between text-[12px] text-fg-3">
            <span>{text('更省流量', 'Fewer bytes')}</span>
            <span className="font-medium text-fg">{granularityLabel(plan.granularity)}</span>
            <span>{text('更少文件', 'Fewer files')}</span>
          </div>
          <Slider
            disabled={running}
            label={text('分包粒度', 'Granularity')}
            max={GRANULARITY_LEVELS}
            min={1}
            onChange={(granularity) => {
              controller.updatePlan({ granularity });
            }}
            value={plan.granularity}
            valueText={granularityLabel(plan.granularity)}
          />
        </div>
      ) : (
        <p className="text-[12.5px] leading-5 text-fg-3">
          {text(
            '适合只有少量文字的标题与 Logo；正文站点请使用按需分片。',
            'Best for headlines and logos with little text; use on-demand shards for body copy.',
          )}
        </p>
      )}
    </div>
  );
}

function AdvancedOutput() {
  const { text } = usePreferences();
  const controller = useController();
  const output = useAppState((state) => state.output);
  const running = useAppState((state) => state.run.phase === 'running');
  return (
    <Disclosure
      aside={text('影响分片内容，改后需重新生成', 'Changes shard bytes; regenerate after')}
      summary={text('高级', 'Advanced')}
    >
      <div className="divide-y divide-line rounded-lg border border-line px-3">
        <Switch
          checked={output.cjkFeatures}
          description={text(
            '保留 palt 标点挤压、tnum 等宽数字，以及代码字体的 ss01–ss20 风格集与 cv 字符变体。连字与字距始终保留',
            'Keeps palt punctuation spacing, tnum figures, and the ss01–ss20 stylistic sets and cv variants of code fonts. Ligatures and kerning are always kept',
          )}
          disabled={running}
          label={text('保留排版特性', 'Keep layout features')}
          onChange={(cjkFeatures) => {
            controller.updateOutput({ cjkFeatures });
          }}
        />
        <Switch
          checked={output.trimMetadata}
          description={text(
            '去掉多语言重复名称与网页无用的表，保留版权与许可。每片省 0.3–1 KB',
            'Drops duplicate localized names and unused tables; keeps copyright and license. Saves 0.3–1 KB per shard',
          )}
          disabled={running}
          label={text('精简元数据', 'Trim metadata')}
          onChange={(trimMetadata) => {
            controller.updateOutput({ trimMetadata });
          }}
        />
        <Switch
          checked={output.keepHinting}
          description={text(
            '保留 TrueType 微调指令。体积明显增大，仅 Windows 小字号有要求时开启',
            'Keeps TrueType hinting. Noticeably larger; only for small sizes on Windows',
          )}
          disabled={running}
          label={text('保留 hinting', 'Keep hinting')}
          onChange={(keepHinting) => {
            controller.updateOutput({ keepHinting });
          }}
        />
      </div>
    </Disclosure>
  );
}

export function PlanPanel({ compact = false }: { readonly compact?: boolean }) {
  const { text, locale } = usePreferences();
  const controller = useController();
  const plan = useAppState(selectExportPlan);
  const blockers = useAppState(selectBlockers);
  const inputKey = useAppState(selectInputKey);
  const run = useAppState((state) => state.run);
  const profileId = useAppState((state) => state.pageProfile);
  const frequency = useAppState((state) => state.data.frequency);
  const textProfile = useAppState(selectTextProfile);
  const script = useAppState(selectFontScript);
  const primary = plan?.outputs.find((output) => output.id === plan.primaryOutputId) ?? null;
  const previewFamily = usePreviewFamily(primary?.sourceId);
  const running = run.phase === 'running';
  const result = run.result;
  const fresh = result !== null && result.inputKey === inputKey;
  const elapsed = useElapsed(run.progress?.startedAt ?? null);

  const measuredPrimary = fresh
    ? result.context.outputs.find((output) => output.id === primary?.id)
    : undefined;
  const chartShards = useMemo<ChartShard[]>(() => {
    if (measuredPrimary !== undefined) {
      return measuredPrimary.shards.map((shard) => ({
        id: `${measuredPrimary.id}|${shard.key}`,
        key: shard.key,
        kind: shard.kind,
        bytes: shard.bytes,
        mass: shard.mass,
        preload: shard.preload,
        codePoints: shard.codePoints,
      }));
    }
    if (primary === null) return [];
    return primary.shards.map((shard) => ({
      id: `${primary.id}|${shard.key}`,
      key: shard.key,
      kind: shard.kind,
      bytes: shard.estimatedBytes,
      mass: shard.mass,
      preload: shard.preload,
      codePoints: shard.codePoints,
    }));
  }, [measuredPrimary, primary]);

  const metrics = useMemo(
    () =>
      evaluateShards(
        chartShards.map((shard) => ({ kind: shard.kind, mass: shard.mass, bytes: shard.bytes })),
      ),
    [chartShards],
  );
  const current = profileMetrics(metrics, profileId);
  // 比较基准是同一批字符打成单个文件的估算体积；整字体单文件的压缩率明显好于分片之和。
  const singleBytes = primary?.singleFileBytes ?? 0;
  const isSingle = chartShards.length === 1 && chartShards[0]?.kind === 'single';
  const savings = singleBytes === 0 ? 0 : 1 - current.expectedBytes / singleBytes;
  const coverage = useMemo(
    () =>
      primary === null || frequency === null
        ? null
        : corpusCoverage(primary.available, frequency, textProfile),
    [frequency, primary, textProfile],
  );
  const totalBytes = fresh
    ? result.context.outputs.reduce((sum, output) => sum + output.metrics.totalBytes, 0)
    : (plan?.totalEstimatedBytes ?? 0);
  const totalShards = fresh
    ? result.context.outputs.reduce((sum, output) => sum + output.shards.length, 0)
    : (plan?.totalShardCount ?? 0);
  const faceCount = plan?.outputs.length ?? 0;
  const issues = plan?.issues ?? [];
  const blocking = blockers.filter((blocker) => blocker.code !== 'running');
  const canGenerate = !running && blocking.length === 0 && plan !== null && issues.length === 0;

  const advice = useMemo(() => {
    if (primary === null || metrics.shardCount < 2 || singleBytes === 0) return null;
    const article = profileMetrics(metrics, 'article');
    const share = article.expectedBytes / singleBytes;
    if (share > 0.8) {
      const percent = formatPercent(Math.min(share, 9.99), 0);
      return text(
        `字符集较小，文章页预计下载单文件体积的 ${percent}。更在意请求数的话，把粒度拖向"更少文件"，或改用单文件。`,
        `This set is small: an article page downloads ${percent} of the single-file size. If request count matters more, drag towards fewer files or use a single file.`,
      );
    }
    if (article.expectedRequests > 24) {
      return text(
        '典型页面需要二十多个请求。若站点仍在使用 HTTP/1.1，建议把粒度拖向"更少文件"。',
        'A typical page needs over twenty requests. If your site still serves HTTP/1.1, drag towards fewer files.',
      );
    }
    return null;
  }, [metrics, primary, singleBytes, text]);

  const profileLabel: Record<PageProfileId, string> = {
    headline: text('短页', 'Short'),
    article: text('文章', 'Article'),
    longform: text('长文', 'Long'),
  };

  const progress = run.progress;
  const percent =
    progress === null || progress.total === 0 ? 0 : progress.completed / progress.total;
  const eta =
    progress !== null && progress.completed > 0
      ? (elapsed / progress.completed) * (progress.total - progress.completed)
      : null;

  return (
    <section
      aria-labelledby="plan-heading"
      className={cx(
        'scroll-mt-20 bg-surface',
        compact ? 'rounded-t-2xl' : 'rounded-xl border border-line shadow-card',
      )}
      id="plan"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight" id="plan-heading">
          {fresh ? text('分包结果', 'Result') : text('分包预览', 'Plan preview')}
        </h2>
        <Segmented
          label={text('典型页面长度', 'Typical page length')}
          onChange={(value) => {
            controller.setPageProfile(value);
          }}
          options={PAGE_PROFILES.map((profile) => ({
            value: profile.id,
            label: profileLabel[profile.id],
            hint: text(
              `约 ${String(profile.tokens)} 字的页面`,
              `A page of about ${String(profile.tokens)} characters`,
            ),
          }))}
          size="sm"
          value={profileId}
        />
      </header>

      <div className="grid gap-4 px-5 py-4">
        {primary === null ? (
          <div className="grid h-40 place-items-center rounded-md border border-dashed border-line-strong text-center text-[13px] text-fg-3">
            <p className="max-w-56">
              {blocking[0] === undefined
                ? text('正在准备预览…', 'Preparing preview…')
                : describeBlocker(blocking[0], text)}
            </p>
          </div>
        ) : (
          <LoadChart
            done={progress?.done ?? null}
            measured={measuredPrimary !== undefined}
            running={running}
            sampleFamily={previewFamily}
            shards={chartShards}
            tokens={pageProfile(profileId).tokens}
          />
        )}

        {primary === null ? null : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Metric
              className="col-span-2"
              detail={text(
                `约 ${String(pageProfile(profileId).tokens)} 字的${profileLabel[profileId]}页首次访问`,
                `first visit to a ~${String(pageProfile(profileId).tokens)}-character page`,
              )}
              emphasis
              label={
                measuredPrimary === undefined
                  ? text('每页预计下载', 'Estimated per page')
                  : text('每页实际下载', 'Per page')
              }
              value={`${formatBytes(current.expectedBytes)} · ${current.expectedRequests.toFixed(1)} ${text('个文件', 'files')}`}
            />
            <Metric
              detail={
                singleBytes === 0
                  ? undefined
                  : text(
                      `单文件约 ${formatBytes(singleBytes)}`,
                      `single file ≈ ${formatBytes(singleBytes)}`,
                    )
              }
              label={text('相比单文件', 'vs. single file')}
              value={
                isSingle || singleBytes === 0
                  ? '—'
                  : `${savings >= 0 ? '−' : '+'}${formatPercent(Math.abs(savings), 0)}`
              }
            />
            {script === 'western' ? (
              // 字频来自中文语料，对西文字体没有意义：改为显示实际打包的字符数。
              <Metric
                detail={text('按文字分组成片', 'grouped by script')}
                label={text('字符', 'Characters')}
                value={formatNumber(primary.available.length, locale)}
              />
            ) : (
              <Metric
                detail={text('日常文本中的字被覆盖的比例', 'share of everyday text covered')}
                label={text('常用字覆盖', 'Everyday coverage')}
                value={coverage === null ? '—' : formatPercent(coverage, coverage > 0.999 ? 2 : 1)}
              />
            )}
            <Metric
              detail={
                faceCount > 1
                  ? text(`${String(faceCount)} 个款式`, `${String(faceCount)} faces`)
                  : text('部署到服务器的总量', 'total uploaded to the server')
              }
              label={text('全部文件', 'All files')}
              value={`${formatNumber(totalShards, locale)} · ${formatBytes(totalBytes)}`}
            />
            <Metric
              detail={
                plan !== null && plan.totalSourceBytes > 0
                  ? text(
                      `分片总量是原字体的 ${formatPercent(totalBytes / plan.totalSourceBytes, 0)}`,
                      `shards total ${formatPercent(totalBytes / plan.totalSourceBytes, 0)} of the source`,
                    )
                  : undefined
              }
              label={text('原字体', 'Source font')}
              value={plan === null ? '—' : formatBytes(plan.totalSourceBytes)}
            />
          </dl>
        )}

        <ShardingControls />

        {advice === null || running ? null : (
          <p className="flex gap-2 rounded-lg bg-inset px-3 py-2.5 text-[13px] leading-5 text-fg-2">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
            {advice}
          </p>
        )}

        {!running && (issues.length > 0 || blocking.length > 0) ? (
          <ul aria-live="polite" className="grid gap-1.5">
            {blocking.map((blocker, index) => (
              <li
                className="flex items-start gap-2 text-[13px] text-fg-2"
                key={`b${String(index)}`}
              >
                <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                {describeBlocker(blocker, text)}
              </li>
            ))}
            {issues.map((issue, index) => (
              <li
                className="flex items-start gap-2 text-[13px] text-danger"
                key={`i${String(index)}`}
              >
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                {describeIssue(issue, text)}
              </li>
            ))}
          </ul>
        ) : null}

        {running && progress !== null ? (
          <div aria-live="polite" className="grid gap-3">
            <div
              aria-label={text('生成进度', 'Progress')}
              aria-valuemax={progress.total}
              aria-valuemin={0}
              aria-valuenow={progress.completed}
              className="h-2 overflow-hidden rounded-full bg-hover"
              role="progressbar"
            >
              <div
                className="progress-stripes h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${String(Math.max(2, percent * 100))}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-fg-2 tabular">
              <span>
                {text(
                  `${String(progress.completed)} / ${String(progress.total)} 片`,
                  `${String(progress.completed)} / ${String(progress.total)} shards`,
                )}
                <span className="text-fg-3">
                  {' · '}
                  {formatDuration(elapsed, locale)}
                  {eta !== null && progress.completed < progress.total
                    ? text(
                        ` · 约剩 ${formatDuration(eta, locale)}`,
                        ` · ~${formatDuration(eta, locale)} left`,
                      )
                    : ''}
                </span>
              </span>
              {progress.threads > 0 ? (
                <span className="flex items-center gap-1 text-fg-3">
                  <Cpu className="size-3.5" />
                  {text(`${String(progress.threads)} 线程`, `${String(progress.threads)} threads`)}
                </span>
              ) : null}
            </div>
            <Button
              className="w-full"
              onClick={() => {
                controller.cancelRun();
              }}
              size="lg"
            >
              {text('取消', 'Cancel')} <Kbd>Esc</Kbd>
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            {run.phase === 'error' ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
                role="alert"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1 break-words">
                  {localizeEngineError(run.error ?? '', text)}
                </span>
                <IconButton
                  className="-my-1 size-6"
                  label={text('关闭', 'Dismiss')}
                  onClick={() => {
                    controller.dismissRunMessage();
                  }}
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ) : null}
            {run.phase === 'cancelled' ? (
              <p className="text-[13px] text-fg-3" role="status">
                {text('已取消，设置都已保留', 'Cancelled; all settings are kept')}
              </p>
            ) : null}
            {fresh ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-[13px] text-ok">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4" />
                  {text(
                    `已生成 · 用时 ${formatDuration(result.context.elapsedMs, locale)}`,
                    `Done in ${formatDuration(result.context.elapsedMs, locale)}`,
                  )}
                </span>
                <a
                  className="focus-ring flex items-center gap-1 rounded font-medium hover:underline"
                  href="#result"
                >
                  {text('查看结果', 'View result')}
                  <ArrowDown className="size-3.5" />
                </a>
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={!canGenerate}
                onClick={() => {
                  void controller.generate();
                }}
                size="lg"
                variant="primary"
              >
                {result === null
                  ? text(
                      `生成 ${formatNumber(totalShards, locale)} 个分片`,
                      `Generate ${formatNumber(totalShards, locale)} shards`,
                    )
                  : text('按新设置重新生成', 'Regenerate with new settings')}
                <Kbd>{navigator.platform.toLowerCase().includes('mac') ? '⌘↵' : 'Ctrl ↵'}</Kbd>
              </Button>
            )}
            {result !== null && !fresh && !running ? (
              <p className="text-center text-[12px] text-fg-3">
                {text(
                  '设置已更改，下方结果对应的是上一次生成',
                  'Settings changed; the result below reflects the previous run',
                )}
              </p>
            ) : null}
          </div>
        )}

        <AdvancedOutput />
      </div>
    </section>
  );
}
