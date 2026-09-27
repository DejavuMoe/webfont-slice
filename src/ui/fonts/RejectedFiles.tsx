import { FileWarning, X } from 'lucide-react';
import { usePreferences } from '../../i18n/preferences';
import { useAppState, useController } from '../app-context';
import { describeRejection } from '../messages';
import { IconButton } from '../primitives';

export function RejectedFiles() {
  const { text } = usePreferences();
  const controller = useController();
  const rejected = useAppState((state) => state.rejected);
  if (rejected.length === 0) return null;
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2" role="status">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-medium text-warn">
          <FileWarning className="size-4" />
          {text(
            `${String(rejected.length)} 个文件未加入`,
            `${String(rejected.length)} file(s) skipped`,
          )}
        </p>
        <IconButton
          label={text('关闭', 'Dismiss')}
          onClick={() => {
            controller.dismissRejected();
          }}
        >
          <X className="size-4" />
        </IconButton>
      </div>
      <ul className="mt-1 grid gap-0.5 pb-1 text-[13px] text-fg-2">
        {rejected.map((item) => (
          <li className="flex gap-2" key={item.id}>
            <span className="max-w-[60%] truncate font-medium text-fg">{item.name}</span>
            <span className="text-fg-3">{describeRejection(item.code, text)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
