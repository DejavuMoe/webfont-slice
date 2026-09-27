import { Gauge, Layers, PackageCheck, Upload } from 'lucide-react';
import { usePreferences } from '../i18n/preferences';
import { useAppState, useController } from './app-context';
import { RejectedFiles } from './fonts/RejectedFiles';
import { useFilePicker } from './use-file-picker';

/** 装饰图形：高频片高、长尾片低，示意"按加载概率分片"。不含任何数据。 */
function HeroArt() {
  const bars = Array.from({ length: 36 }, (_, index) => {
    const height = index < 5 ? 1 : Math.max(0.05, Math.exp(-(index - 4) / 7.5));
    const width = index < 5 ? 26 : index < 24 ? 8 : 13;
    return { height, width };
  });
  let x = 0;
  return (
    <div className="relative hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:block">
      <div className="grid-paper absolute inset-0 opacity-70" />
      <div className="relative flex h-full flex-col justify-between p-7">
        <div className="flex items-center justify-between text-[12px] text-fg-3">
          <span className="font-mono tracking-wider">unicode-range</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" />
              {'P ≈ 1'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-cold" />
              {'P → 0'}
            </span>
          </span>
        </div>
        <svg
          aria-hidden="true"
          className="mt-6 h-56 w-full"
          preserveAspectRatio="none"
          viewBox="0 0 470 220"
        >
          {bars.map((bar, index) => {
            const left = x;
            x += bar.width + 2;
            const height = Math.max(6, bar.height * 210);
            return (
              <rect
                className="origin-bottom animate-enter"
                height={height}
                key={index}
                rx="2"
                style={{
                  fill: `color-mix(in oklch, var(--c-accent) ${String(Math.round(bar.height * 100))}%, var(--c-cold))`,
                  animationDelay: `${String(index * 18)}ms`,
                }}
                width={bar.width}
                x={left}
                y={220 - height}
              />
            );
          })}
        </svg>
        <div className="mt-6 grid grid-cols-[auto_1fr] items-end gap-5">
          <span className="font-serif text-[88px] leading-[0.8] text-fg" lang="zh-CN">
            永
          </span>
          <div className="grid gap-2 pb-1">
            {[0.92, 0.7, 0.44].map((width, index) => (
              <span
                className="h-2 rounded-full bg-hover"
                key={index}
                style={{ width: `${String(width * 100)}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const { text } = usePreferences();
  const controller = useController();
  const rejected = useAppState((state) => state.rejected);
  const picker = useFilePicker((files) => {
    void controller.addFiles(files);
  });

  const features = [
    {
      icon: Layers,
      title: text('按字频切片', 'Sliced by frequency'),
      body: text(
        '常用字合并成少数几个文件，生僻字放在很少被请求的文件里。一篇文章通常只碰到十几个文件。',
        'Common characters merge into a few files; rare ones sit in files that are seldom requested. A typical article touches about a dozen.',
      ),
    },
    {
      icon: Gauge,
      title: text('生成前就知道每页多大', 'Know the per-page cost first'),
      body: text(
        '读取每个字形的真实字节并用这款字体实测校准，拖动一下就能看到每页预计下载多少。',
        'Real glyph sizes, calibrated against your font, so you see the per-page download while you adjust.',
      ),
    },
    {
      icon: PackageCheck,
      title: text('复制即可部署', 'Copy, paste, deploy'),
      body: text(
        'unicode-range CSS、预加载标签和带内容哈希的文件名。回退字体交给你自己的 font-family。',
        'unicode-range CSS, preload tags and content-hashed file names. Fallbacks stay in your own font-family stack.',
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-10 pb-16 sm:px-6 lg:pt-16">
      <div className="grid items-stretch gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
        <div className="flex flex-col justify-center">
          <p className="text-[13px] font-medium tracking-wide text-accent">
            {text(
              '中日韩、西文与代码字体分包 · 在浏览器本地完成',
              'Web font sharding for CJK, Latin and code fonts · runs in your browser',
            )}
          </p>
          <h1 className="mt-4 text-[40px] leading-[1.12] font-semibold tracking-tight text-balance sm:text-[52px]">
            {text('只下载页面', 'Ship only the glyphs')}
            <br />
            <span className="text-fg-3">{text('真正用到的字', 'each page uses')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-fg-2">
            {text(
              '把十几 MB 的中文字体切成按需加载的 WOFF2 分片，生成可以直接部署的 CSS。西文与代码等宽字体按文字切分，连字与风格集原样保留。字体和文字都不会离开你的设备。',
              'Slice multi-megabyte CJK fonts into on-demand WOFF2 shards with ready-to-deploy CSS. Latin and monospace code fonts are split by script, ligatures and stylistic sets intact. Nothing leaves your device.',
            )}
          </p>
          <p className="mt-4 max-w-xl text-[13px] leading-6 text-fg-3">
            <span className="font-medium text-fg-2">
              {text('实测 Noto Sans SC：', 'Measured on Noto Sans SC: ')}
            </span>
            {text(
              '全部 30,890 字打成单文件 7.4 MB；分片后一篇文章约下载 890 KB、15 个文件。',
              'all 30,890 characters in one file is 7.4 MB; sharded, an article page downloads about 890 KB across 15 files.',
            )}
          </p>

          <div className="mt-8">
            {picker.element}
            <button
              className="focus-ring group flex w-full items-center gap-5 rounded-2xl border-2 border-dashed border-line-strong bg-surface p-6 text-left shadow-card transition-[border-color,background-color] duration-200 hover:border-accent hover:bg-accent-soft/40"
              onClick={picker.open}
              type="button"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-[0_6px_16px_-6px_var(--c-accent)] transition-transform duration-200 group-hover:-translate-y-0.5">
                <Upload className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">
                  {text('拖入字体文件，或点击选择', 'Drop font files here, or click to browse')}
                </span>
                <span className="mt-1 block text-[13px] text-fg-3">
                  {text(
                    'TTF · OTF · WOFF · WOFF2，可一次加入同一字族的多个字重',
                    'TTF · OTF · WOFF · WOFF2 · add every weight of a family at once',
                  )}
                </span>
              </span>
            </button>
            {rejected.length > 0 ? (
              <div className="mt-4">
                <RejectedFiles />
              </div>
            ) : null}
          </div>
        </div>
        <HeroArt />
      </div>

      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <div
            className="rounded-xl border border-line bg-surface p-5 shadow-card"
            key={feature.title}
          >
            <feature.icon className="size-5 text-accent" />
            <h2 className="mt-3 text-[15px] font-semibold">{feature.title}</h2>
            <p className="mt-1.5 text-[13px] leading-6 text-fg-2">{feature.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
