import { ChevronUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { selectBlockers, selectExportPlan, selectInputKey } from '../../app/derive';
import { profileMetrics } from '../../core/plan-metrics';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController } from '../app-context';
import { formatBytes, formatNumber } from '../format';
import { Button, IconButton } from '../primitives';
import { cx } from '../utils';
import { PlanPanel } from './PlanPanel';

/**
 * 小屏的计划面板：吸底条随时显示每页预估与主操作，点一下展开为底部抽屉，
 * 抽屉里是完整的计划面板（图表、指标、粒度）。大屏由右侧常驻面板承担。
 */
export function PlanSheet() {
  const { text, locale } = usePreferences();
  const controller = useController();
  const plan = useAppState(selectExportPlan);
  const blockers = useAppState(selectBlockers);
  const run = useAppState((state) => state.run);
  const inputKey = useAppState(selectInputKey);
  const profileId = useAppState((state) => state.pageProfile);
  const [open, setOpen] = useState(false);
  const primary = plan?.outputs.find((output) => output.id === plan.primaryOutputId);
  const running = run.phase === 'running';
  const fresh = run.result !== null && run.result.inputKey === inputKey;
  const canGenerate =
    !running && blockers.length === 0 && plan !== null && plan.issues.length === 0;
  const metrics = primary === undefined ? null : profileMetrics(primary.metrics, profileId);
  const progress = run.progress;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const summary = (
    <div className="min-w-0 flex-1 text-[12.5px] leading-5 tabular">
      {running && progress !== null ? (
        <>
          <p className="font-medium text-fg">
            {text(
              `正在生成 ${String(progress.completed)} / ${String(progress.total)} 片`,
              `Generating ${String(progress.completed)} / ${String(progress.total)}`,
            )}
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{
                width: `${String(progress.total === 0 ? 0 : (progress.completed / progress.total) * 100)}%`,
              }}
            />
          </div>
        </>
      ) : metrics === null ? (
        <p className="text-fg-3">
          {text('等待字体与字符就绪', 'Waiting for fonts and characters')}
        </p>
      ) : (
        <>
          <p className="truncate font-medium text-fg">
            {text(
              `每页约 ${formatBytes(metrics.expectedBytes)} · ${metrics.expectedRequests.toFixed(1)} 个文件`,
              `≈ ${formatBytes(metrics.expectedBytes)} · ${metrics.expectedRequests.toFixed(1)} files per page`,
            )}
          </p>
          <p className="truncate text-fg-3">
            {text(
              `共 ${formatNumber(plan?.totalShardCount ?? 0, locale)} 片 · 点击查看分包图`,
              `${formatNumber(plan?.totalShardCount ?? 0, locale)} shards · tap for the chart`,
            )}
          </p>
        </>
      )}
    </div>
  );

  return (
    <>
      <div
        className={cx(
          'fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-2.5 shadow-pop backdrop-blur lg:hidden',
          open && 'invisible',
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <button
            aria-expanded={open}
            className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 text-left"
            onClick={() => {
              setOpen(true);
            }}
            type="button"
          >
            {summary}
            <ChevronUp className="size-4 shrink-0 text-fg-3" />
          </button>
          {running ? (
            <Button
              onClick={() => {
                controller.cancelRun();
              }}
            >
              {text('取消', 'Cancel')}
            </Button>
          ) : fresh ? (
            <a
              className="focus-ring inline-flex h-9 items-center rounded-md bg-ok-soft px-3.5 text-sm font-medium text-ok"
              href="#result"
            >
              {text('查看结果', 'View result')}
            </a>
          ) : (
            <Button
              disabled={!canGenerate}
              onClick={() => {
                void controller.generate();
              }}
              variant="primary"
            >
              {text('生成', 'Generate')}
            </Button>
          )}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label={text('关闭', 'Close')}
            className="absolute inset-0 bg-fg/40 backdrop-blur-[2px]"
            onClick={() => {
              setOpen(false);
            }}
            type="button"
          />
          <div
            aria-label={text('分包预览', 'Plan preview')}
            aria-modal="true"
            className="animate-sheet absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-surface shadow-pop scrollbar-thin"
            role="dialog"
          >
            <div className="sticky top-0 z-10 flex justify-center bg-surface/95 pt-2 pb-1 backdrop-blur">
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-strong" />
              <IconButton
                className="absolute top-1 right-3"
                label={text('关闭', 'Close')}
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <PlanPanel compact />
          </div>
        </div>
      ) : null}
    </>
  );
}
