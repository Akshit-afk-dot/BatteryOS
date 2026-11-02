"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/format";

// ---------------------------------------------------------------- button

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-zinc-900 text-white shadow-card hover:bg-zinc-800",
        brand: "bg-brand-700 text-white shadow-card hover:bg-brand-800",
        secondary: "bg-white text-zinc-800 ring-1 ring-inset ring-zinc-200 shadow-card hover:bg-zinc-50",
        ghost: "text-zinc-700 hover:bg-zinc-100",
        danger: "bg-rose-600 text-white shadow-card hover:bg-rose-700",
        "danger-ghost": "text-rose-700 hover:bg-rose-50",
        link: "text-brand-700 underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-2.5 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export function ButtonLink({
  href,
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- form controls

const control =
  "w-full rounded-lg bg-white text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-zinc-50 disabled:text-zinc-500 aria-[invalid=true]:ring-rose-400";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, "h-9 px-3", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(control, "min-h-20 px-3 py-2 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        control,
        "h-9 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-8",
        "bg-[url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.6' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-zinc-700", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
  aside,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor}>
            {label}
            {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
          </Label>
          {aside}
        </div>
      ) : null}
      {children}
      {error ? <p className="text-xs text-rose-600">{error}</p> : hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const autoId = React.useId();
  const cid = id ?? autoId;
  return (
    <label htmlFor={cid} className={cn("flex items-start gap-2.5 text-sm", disabled && "opacity-60", className)}>
      <input
        id={cid}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-brand-700"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label || description ? (
        <span className="flex flex-col">
          {label ? <span className="font-medium text-zinc-800">{label}</span> : null}
          {description ? <span className="text-xs text-zinc-500">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-zinc-300",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl bg-white ring-1 ring-zinc-200/80 shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <div className="mt-0.5 text-zinc-400 [&_svg]:size-4">{icon}</div> : null}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-zinc-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-zinc-500">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- badges & feedback

const tones = {
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  sky: "bg-sky-50 text-sky-800 ring-sky-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
  indigo: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  orange: "bg-orange-50 text-orange-800 ring-orange-200",
  emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  rose: "bg-rose-50 text-rose-800 ring-rose-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200",
  cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  dark: "bg-zinc-800 text-zinc-50 ring-zinc-800",
} as const;
export type Tone = keyof typeof tones;

export function Badge({
  tone = "zinc",
  className,
  children,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset [&_svg]:size-3",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-zinc-400", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-zinc-200/70", className)} />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("h-9", i % 2 ? "w-4/5" : "w-full")} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 [&_svg]:size-5">{icon}</div>
      ) : null}
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "zinc",
  icon,
  title,
  children,
  className,
  action,
}: {
  tone?: "zinc" | "amber" | "rose" | "sky" | "emerald" | "violet";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const map = {
    zinc: "bg-zinc-50 ring-zinc-200 text-zinc-700",
    amber: "bg-amber-50 ring-amber-200 text-amber-900",
    rose: "bg-rose-50 ring-rose-200 text-rose-900",
    sky: "bg-sky-50 ring-sky-200 text-sky-900",
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-900",
    violet: "bg-violet-50 ring-violet-200 text-violet-900",
  };
  return (
    <div className={cn("flex gap-3 rounded-lg px-3.5 py-3 text-sm ring-1 ring-inset", map[tone], className)}>
      {icon ? <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-[13px] opacity-90", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- table

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto scrollbar-thin">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-zinc-200 bg-zinc-50/70" {...props} />;
}
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("whitespace-nowrap px-4 py-2 text-left text-xs font-medium text-zinc-500", className)} {...props} />;
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-zinc-100 last:border-0", className)} {...props} />;
}
export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-2.5 align-middle text-zinc-700", className)} {...props} />;
}

// ---------------------------------------------------------------- misc

export function Mono({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-mono text-[12.5px] tracking-tight", className)} {...props} />;
}

export function KV({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode; aside?: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-zinc-100", className)}>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <dt className="text-zinc-500">{it.label}</dt>
          <dd className="min-w-0 break-words text-zinc-900">{it.value}</dd>
          {it.aside ? <dd className="col-span-2 sm:col-span-1 sm:justify-self-end">{it.aside}</dd> : <dd className="hidden sm:block" />}
        </div>
      ))}
    </dl>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-white text-zinc-900 shadow-card ring-1 ring-zinc-200" : "text-zinc-600 hover:text-zinc-900",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className="tabular text-xs text-zinc-400">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
