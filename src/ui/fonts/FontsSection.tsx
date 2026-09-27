import { Plus } from 'lucide-react';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController } from '../app-context';
import { formatBytes } from '../format';
import { useFilePicker } from '../use-file-picker';
import { Button, Section } from '../primitives';
import { FontCard } from './FontCard';
import { RejectedFiles } from './RejectedFiles';

export function FontsSection() {
  const { text } = usePreferences();
  const controller = useController();
  const fonts = useAppState((state) => state.fonts);
  const checking = useAppState((state) => state.checkingFiles);
  const running = useAppState((state) => state.run.phase === 'running');
  const picker = useFilePicker((files) => {
    void controller.addFiles(files);
  });
  const totalSize = fonts.reduce((total, font) => total + font.file.size, 0);

  return (
    <Section
      aside={
        <div className="flex items-center gap-1">
          {picker.element}
          <Button
            disabled={running}
            icon={<Plus className="size-4" />}
            onClick={picker.open}
            size="sm"
          >
            {text('添加', 'Add')}
          </Button>
          <Button
            disabled={running || fonts.length === 0}
            onClick={() => {
              controller.clearFonts();
            }}
            size="sm"
            variant="ghost"
          >
            {text('清空', 'Clear')}
          </Button>
        </div>
      }
      description={
        fonts.length === 0
          ? text('正在检查文件…', 'Checking files…')
          : text(
              `${String(fonts.length)} 个文件 · ${formatBytes(totalSize)} · 可继续拖入同一字族的其他字重`,
              `${String(fonts.length)} file(s) · ${formatBytes(totalSize)} · drop more weights of the family anywhere`,
            )
      }
      id="fonts"
      index="01"
      title={text('字体', 'Fonts')}
    >
      <div className="grid gap-3">
        <RejectedFiles />
        {fonts.map((font) => (
          <FontCard font={font} key={font.id} />
        ))}
        {checking > 0 ? (
          <p className="text-[13px] text-fg-3" role="status">
            {text('正在检查文件签名…', 'Checking file signatures…')}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
