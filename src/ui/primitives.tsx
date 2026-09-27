import { Check, ChevronRight, Copy, Info } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { usePreferences } from '../i18n/preferences';
import { cx, useCopy } from './utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_1px_0_rgb(255_255_255/0.18)_inset,0_1px_2px_rgb(0_0_0/0.18)] disabled:opacity-45',
  secondary:
    'bg-surface text-fg border border-line-strong hover:bg-hover shadow-card disabled:opacity-50',
  ghost: 'text-fg-2 hover:text-fg hover:bg-hover disabled:opacity-40',
  danger: 'text-danger hover:bg-danger-soft disabled:opacity-40',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
  lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-lg font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        'focus-ring inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,box-shadow,opacity] duration-150',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly label: string }) {
  return (
    <button
      aria-label={label}
      className={cx(
        'focus-ring inline-grid size-8 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
        className,
      )}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly hint?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  size = 'md',
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  readonly size?: 'sm' | 'md';
}) {
  const name = useId();
  return (
    <div
      aria-label={label}
      className={cx(
        'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-hover p-0.5 scrollbar-thin',
        disabled && 'opacity-50',
      )}
      role="radiogroup"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            className={cx(
              'focus-ring-within relative flex cursor-pointer items-center justify-center rounded-md whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-[13px]',
              checked ? 'bg-surface text-fg shadow-card font-medium' : 'text-fg-2 hover:text-fg',
              disabled && 'cursor-not-allowed',
            )}
            key={option.value}
            title={option.hint}
          >
            <input
              checked={checked}
              className="sr-only"
              disabled={disabled}
              name={name}
              onChange={() => {
                onChange(option.value);
              }}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <label className="min-w-0 cursor-pointer" htmlFor={id}>
        <span className="block text-sm text-fg">{label}</span>
        {description === undefined ? null : (
          <span className="mt-0.5 block text-[13px] leading-5 text-fg-3" id={`${id}-description`}>
            {description}
          </span>
        )}
      </label>
      <button
        aria-checked={checked}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        className={cx(
          'focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
        disabled={disabled}
        id={id}
        onClick={() => {
          onChange(!checked);
        }}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out)]',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  valueText,
  disabled,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly valueText?: string;
  readonly disabled?: boolean;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <input
      aria-label={label}
      aria-valuetext={valueText}
      className="range"
      disabled={disabled}
      max={max}
      min={min}
      onChange={(event) => {
        onChange(Number(event.target.value));
      }}
      step={step}
      style={{ '--value': `${String(percent)}%` } as CSSProperties}
      type="range"
      value={value}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: string | null;
  readonly children: ReactNode;
  readonly htmlFor: string;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <label className="text-[13px] font-medium text-fg-2" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[13px] text-danger" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : hint === undefined ? null : (
        <p className="text-[13px] leading-5 text-fg-3" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  children,
  disabled,
  title,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly title?: string;
}) {
  return (
    <button
      aria-pressed={pressed}
      className={cx(
        'focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-[background-color,border-color,color] duration-150 disabled:opacity-50',
        pressed
          ? 'border-accent/50 bg-accent-soft text-fg'
          : 'border-line-strong bg-surface text-fg-2 hover:border-fg-3 hover:text-fg',
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid size-3.5 place-items-center rounded-full border transition-colors',
          pressed ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
        )}
      >
        {pressed ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
      </span>
      {children}
    </button>
  );
}

export function Disclosure({
  summary,
  aside,
  children,
  defaultOpen = false,
  className,
}: {
  readonly summary: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}) {
  return (
    <details className={cx('group', className)} open={defaultOpen}>
      <summary className="focus-ring flex cursor-pointer items-center gap-2 rounded-md py-1.5 text-sm text-fg-2 select-none hover:text-fg">
        <ChevronRight
          aria-hidden="true"
          className="disclosure-chevron size-4 shrink-0 transition-transform duration-200"
        />
        <span className="font-medium">{summary}</span>
        {aside === undefined ? null : (
          <span className="ml-auto truncate pl-3 text-[13px] text-fg-3">{aside}</span>
        )}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

const POPOVER_WIDTH = 272;
const POPOVER_MARGIN = 12;

/** 把气泡固定定位在触发元素下方（放不下时上方），并夹在视口内，不会被容器裁切或飞出屏幕。 */
function popoverStyle(trigger: HTMLElement | null): CSSProperties | null {
  const rect = trigger?.getBoundingClientRect();
  if (rect === undefined) return null;
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_MARGIN * 2);
  const left = Math.min(
    Math.max(POPOVER_MARGIN, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - POPOVER_MARGIN,
  );
  const below = rect.bottom + 8;
  const fitsBelow = below + 160 <= window.innerHeight || rect.top < window.innerHeight / 2;
  return fitsBelow
    ? { position: 'fixed', left, top: below, width }
    : { position: 'fixed', left, bottom: window.innerHeight - rect.top + 8, width };
}

export function Hint({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  // 打开时即时测量位置；打开期间滚动或改变窗口大小会重新测量。
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const open = style !== null;
  const show = () => {
    setStyle(popoverStyle(trigger.current));
  };
  const hide = () => {
    setStyle(null);
  };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      setStyle(popoverStyle(trigger.current));
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  return (
    <span className="inline-flex align-middle">
      <button
        aria-describedby={open ? id : undefined}
        aria-label={label}
        className="focus-ring inline-grid size-5 place-items-center rounded-full text-fg-3 hover:text-fg"
        onBlur={hide}
        onClick={() => {
          if (open) hide();
          else show();
        }}
        onFocus={show}
        onMouseEnter={show}
        onMouseLeave={hide}
        ref={trigger}
        type="button"
      >
        <Info className="size-3.5" />
      </button>
      {style === null ? null : (
        <span
          className="animate-enter z-40 rounded-lg border border-line bg-surface p-3 text-[13px] leading-5 font-normal text-fg-2 shadow-pop"
          id={id}
          role="tooltip"
          style={style}
        >
          {children}
        </span>
      )}
    </span>
  );
}

export function CodeBlock({
  code,
  label,
  copy,
  maxHeight = 320,
}: {
  readonly code: string;
  readonly label: string;
  readonly copy: (text: string) => Promise<void>;
  readonly maxHeight?: number;
}) {
  const { text } = usePreferences();
  const { copied, failed, run } = useCopy(copy);
  return (
    <div className="group relative overflow-hidden rounded-lg border border-line bg-inset">
      <pre
        aria-label={label}
        className="scrollbar-thin overflow-auto p-4 pr-24 font-mono text-[12.5px] leading-[1.7] text-fg-2"
        style={{ maxHeight }}
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
      <Button
        aria-label={`${text('复制', 'Copy')} ${label}`}
        className="absolute top-2.5 right-2.5"
        icon={copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
        onClick={() => {
          run(code);
        }}
        size="sm"
      >
        {copied
          ? text('已复制', 'Copied')
          : failed
            ? text('复制失败', 'Failed')
            : text('复制', 'Copy')}
      </Button>
    </div>
  );
}

export function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/30 px-1 font-sans text-[11px] leading-none">
      {children}
    </kbd>
  );
}

export function Section({
  id,
  index,
  title,
  description,
  aside,
  children,
}: {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="scroll-mt-20 rounded-xl border border-line bg-surface shadow-card"
      id={id}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 font-mono text-[12px] font-medium tracking-wider text-accent tabular"
          >
            {index}
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-fg" id={headingId}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{description}</p>
            )}
          </div>
        </div>
        {aside}
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
