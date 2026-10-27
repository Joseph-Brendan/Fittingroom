import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from "react";

type IconSize = 16 | 20;

interface IconProps {
  className?: string;
  size?: IconSize;
}

function iconBase(size: IconSize, className: string | undefined, children: ReactNode) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function MarkIcon({ className, size = 20 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3" />
      <path d="M16 4h3a1 1 0 0 1 1 1v3" />
      <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M8 12h8" />
    </>,
  );
}

export function PinIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M12 17v5" />
      <path d="m9 10-5 4h16l-5-4V4H9z" />
    </>,
  );
}

export function RefreshIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>,
  );
}

export function UndoIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="m9 14-5-5 5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
    </>,
  );
}

export function RedoIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h2" />
    </>,
  );
}

export function ChevronDownIcon({ className, size = 16 }: IconProps) {
  return iconBase(size, className, <path d="m6 9 6 6 6-6" />);
}

export function ChevronRightIcon({ className, size = 16 }: IconProps) {
  return iconBase(size, className, <path d="m9 6 6 6-6 6" />);
}

export function CloseIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>,
  );
}

export function PanelIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M15 4v16" />
    </>,
  );
}

export function ExpandIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
    </>,
  );
}

export function ArrowUpIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>,
  );
}

export function PromoteIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M5 4h14" />
      <path d="M12 20V8" />
      <path d="m7 13 5-5 5 5" />
    </>,
  );
}

export function ArrowDownIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>,
  );
}

export function EyeOffIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="m3 3 18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4 10 7a13 13 0 0 1-2.1 3.2" />
      <path d="M6.1 6.1C4.2 7.5 3 9.4 2 12c1 3 5 7 10 7a10 10 0 0 0 4.1-.9" />
    </>,
  );
}

export function GroupIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <rect height="7" rx="1.5" width="7" x="3" y="3" />
      <rect height="7" rx="1.5" width="7" x="14" y="3" />
      <rect height="7" rx="1.5" width="7" x="3" y="14" />
      <rect height="7" rx="1.5" width="7" x="14" y="14" />
    </>,
  );
}

export function CheckIcon({ className, size = 16 }: IconProps) {
  return iconBase(size, className, <path d="m4 12 5 5L20 6" />);
}

export function InfoIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>,
  );
}

export function AlertIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M10.3 4.1 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>,
  );
}

export function WarningIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </>,
  );
}

export function TrashIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </>,
  );
}

export function CopyIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <rect height="12" rx="2" width="12" x="8" y="8" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>,
  );
}

export function PlusIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>,
  );
}

export function LayersIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 16 9 5 9-5" />
    </>,
  );
}

export function SlidersIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>,
  );
}

export function ListIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </>,
  );
}

export function ExternalLinkIcon({ className, size = 16 }: IconProps) {
  return iconBase(
    size,
    className,
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>,
  );
}

export function SpinnerIcon({ className, size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className === undefined ? "spinner" : `spinner ${className}`}
      fill="none"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" opacity="0.25" r="8" stroke="currentColor" strokeWidth="3" />
      <path d="M20 12a8 8 0 0 0-8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  loading?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export function Button({
  children,
  className,
  disabled,
  icon,
  loading = false,
  size = "md",
  type = "button",
  variant = "secondary",
  ...rest
}: ButtonProps) {
  const classes = ["button", `button-${variant}`, `button-${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      type={type}
      {...rest}
    >
      {loading ? <SpinnerIcon /> : icon}
      {children === undefined ? null : <span className="button-label">{children}</span>}
    </button>
  );
}

interface IconButtonProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  children: ReactNode;
  label: string;
  pressed?: boolean;
  tooltip?: string;
  variant?: "ghost" | "secondary" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, label, pressed, tooltip, type = "button", variant = "ghost", ...rest },
  ref,
) {
  const classes = ["icon-button", `icon-button-${variant}`, className].filter(Boolean).join(" ");

  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={classes}
      ref={ref}
      title={tooltip ?? label}
      type={type}
      {...rest}
    >
      {children}
    </button>
  );
});

interface SegmentedControlProps {
  label: string;
  onChange: (value: number) => void;
  options: ReadonlyArray<{ label: string; value: number }>;
  value: number;
}

export function SegmentedControl({ label, onChange, options, value }: SegmentedControlProps) {
  return (
    <fieldset aria-label={label} className="segmented-control">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className="segmented-button"
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

interface TabItem {
  count?: number;
  icon?: ReactNode;
  id: string;
  label: string;
}

interface TabsProps {
  active: string;
  idPrefix: string;
  label: string;
  onChange: (id: string) => void;
  tabs: TabItem[];
}

export function Tabs({ active, idPrefix, label, onChange, tabs }: TabsProps) {
  return (
    <div aria-label={label} className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-controls={`${idPrefix}-${tab.id}`}
          aria-selected={active === tab.id}
          className="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          tabIndex={active === tab.id ? 0 : -1}
          type="button"
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.count === undefined ? null : <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface ToastMessage {
  id: string;
  message: string;
}

interface ToastStackProps {
  onDismiss: (id: string) => void;
  toasts: ToastMessage[];
}

export function ToastStack({ onDismiss, toasts }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div aria-live="polite" className="toast-stack">
      {toasts.map((toast) => (
        <div className="toast" data-testid="toast" key={toast.id} role="status">
          <InfoIcon className="toast-icon" />
          <p className="toast-message">{toast.message}</p>
          <IconButton
            label="Close notification"
            onClick={() => onDismiss(toast.id)}
            variant="ghost"
          >
            <CloseIcon />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

interface SkeletonProps {
  className?: string;
  height?: string;
  width?: string;
}

export function Skeleton({ className, height = "16px", width = "100%" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={["skeleton", className].filter(Boolean).join(" ")}
      style={{ height, width }}
    />
  );
}
