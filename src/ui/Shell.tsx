import {
  Languages,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { REPOSITORY_URL } from '../core/project';
import { usePreferences, type ThemeMode } from '../i18n/preferences';
import { useAppState, useController } from './app-context';
import { Landing } from './Landing';
import { ResultSection } from './result/ResultSection';
import { Workbench } from './Workbench';
import { PreviewRegistry } from './fonts/preview-registry';
import { Button, IconButton } from './primitives';
import { cx } from './utils';

export interface ShellStatus {
  readonly online: boolean;
  readonly offlineReady: boolean;
}

function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 512 512">
      <rect fill="currentColor" height="512" rx="112" width="512" />
      <path
        className="fill-bg"
        d="M116 112h280v64H284v56h91v62h-91v106h-70V294h-78v-62h78v-56h-98z"
      />
      <circle className="fill-accent" cx="385" cy="385" r="52" />
    </svg>
  );
}

/** GitHub 标志（Octicons mark-github）。 */
function GitHubMark({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

function ThemeToggle() {
  const { theme, setTheme, text } = usePreferences();
  const order: readonly ThemeMode[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(theme) + 1) % order.length] ?? 'system';
  const label = {
    system: text('主题：跟随系统', 'Theme: system'),
    light: text('主题：浅色', 'Theme: light'),
    dark: text('主题：深色', 'Theme: dark'),
  }[theme];
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;
  return (
    <IconButton
      label={label}
      onClick={() => {
        setTheme(next);
      }}
    >
      <Icon className="size-4" />
    </IconButton>
  );
}

function Header({ status }: { readonly status: ShellStatus }) {
  const { locale, setLocale, text } = usePreferences();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <a
          aria-label={text('WebFont Slice 首页', 'WebFont Slice home')}
          className="focus-ring flex items-center gap-2.5 rounded-md"
          href="#top"
        >
          <BrandMark className="size-7 text-fg" />
          <span className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight">WebFont Slice</span>
            <span className="hidden text-[13px] text-fg-3 sm:inline">
              {text('网页字体切片', 'Web font slicer')}
            </span>
          </span>
        </a>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={cx(
              'hidden h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium sm:inline-flex',
              status.online
                ? 'border-ok/30 bg-ok-soft text-ok'
                : 'border-line-strong bg-hover text-fg-2',
            )}
            title={text(
              '字体与文本只在此设备上处理，不会上传',
              'Fonts and text are processed on this device and never uploaded',
            )}
          >
            {status.online ? (
              <ShieldCheck className="size-3.5" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            {status.online
              ? status.offlineReady
                ? text('本地处理 · 可离线', 'Local · works offline')
                : text('本地处理', 'Processed locally')
              : text('离线中 · 本地处理', 'Offline · local')}
          </span>
          <IconButton
            label={locale === 'en' ? '切换到中文' : 'Switch to English'}
            onClick={() => {
              setLocale(locale === 'en' ? 'zh-CN' : 'en');
            }}
          >
            <Languages className="size-4" />
          </IconButton>
          <ThemeToggle />
          <a
            aria-label={text('GitHub 源代码', 'Source code on GitHub')}
            className="focus-ring inline-grid size-8 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"
            href={REPOSITORY_URL}
            rel="noreferrer noopener"
            target="_blank"
            title={text('GitHub 源代码', 'Source code on GitHub')}
          >
            <GitHubMark className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { text } = usePreferences();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-fg-3 sm:px-6">
        <p>
          WebFont Slice {__APP_VERSION__} ·{' '}
          {text(
            '基于 HarfBuzz 与 WOFF2，全部在浏览器中运行',
            'Built on HarfBuzz and WOFF2, running entirely in your browser',
          )}{' '}
          ·{' '}
          <a
            className="focus-ring inline-flex items-center gap-1 rounded text-fg-2 underline-offset-2 hover:text-accent hover:underline"
            href={REPOSITORY_URL}
            rel="noreferrer noopener"
            target="_blank"
          >
            <GitHubMark className="size-3.5" />
            {text('开源于 GitHub', 'Open source on GitHub')}
          </a>
        </p>
        <p>
          {text(
            '部署前请确认字体许可允许网页嵌入',
            'Check that the font license allows web embedding',
          )}
        </p>
      </div>
    </footer>
  );
}

function hasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

function DropOverlay() {
  const controller = useController();
  const { text } = usePreferences();
  const running = useAppState((state) => state.run.phase === 'running');
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setActive(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = running ? 'none' : 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setActive(false);
      if (running) return;
      const files = [...(event.dataTransfer?.files ?? [])];
      void controller.addFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [controller, running]);

  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/70 p-6 backdrop-blur-sm"
    >
      <div className="animate-enter grid w-full max-w-lg place-items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface/90 px-8 py-14 text-center shadow-pop">
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Upload className="size-6" />
        </span>
        <p className="text-lg font-semibold">
          {running
            ? text('正在生成，请稍后再添加', 'Generating; add fonts afterwards')
            : text('松开以添加字体', 'Drop to add fonts')}
        </p>
        <p className="text-[13px] text-fg-3">TTF · OTF · WOFF · WOFF2</p>
      </div>
    </div>
  );
}

function UpdateToast({
  onApply,
  onDismiss,
}: {
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  const { text } = usePreferences();
  return (
    <div
      className="animate-enter fixed right-4 bottom-4 z-40 flex max-w-sm items-center gap-3 rounded-xl border border-line bg-surface p-3 pl-4 shadow-pop"
      role="status"
    >
      <p className="text-sm">{text('新版本已就绪', 'A new version is ready')}</p>
      <Button
        icon={<RefreshCw className="size-3.5" />}
        onClick={onApply}
        size="sm"
        variant="primary"
      >
        {text('刷新', 'Reload')}
      </Button>
      <IconButton label={text('稍后', 'Later')} onClick={onDismiss}>
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

function useShortcuts() {
  const controller = useController();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        if (controller.canGenerate()) {
          event.preventDefault();
          void controller.generate();
        }
        return;
      }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        if (controller.store.get().run.phase === 'running') controller.cancelRun();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [controller]);
}

export function Shell({
  status,
  showUpdate,
  onApplyUpdate,
  onDismissUpdate,
}: {
  readonly status: ShellStatus;
  readonly showUpdate: boolean;
  readonly onApplyUpdate: () => void;
  readonly onDismissUpdate: () => void;
}) {
  const { text } = usePreferences();
  const hasFonts = useAppState((state) => state.fonts.length > 0 || state.checkingFiles > 0);
  const hasResult = useAppState((state) => state.run.result !== null);
  useShortcuts();

  return (
    <div className="flex min-h-screen flex-col" id="top">
      <a className="skip-link focus-ring" href="#main">
        {text('跳到主要内容', 'Skip to main content')}
      </a>
      <Header status={status} />
      <main className={cx('flex-1', hasFonts && 'pb-20 lg:pb-0')} id="main">
        <PreviewRegistry>
          {hasFonts ? <Workbench /> : <Landing />}
          {hasFonts && hasResult ? <ResultSection /> : null}
        </PreviewRegistry>
      </main>
      <Footer />
      <DropOverlay />
      {showUpdate ? <UpdateToast onApply={onApplyUpdate} onDismiss={onDismissUpdate} /> : null}
    </div>
  );
}
