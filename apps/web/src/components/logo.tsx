import { cn } from "@/lib/format";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#09090b" />
      <rect x="7" y="10" width="16" height="12" rx="2.5" fill="none" stroke="#c6f432" strokeWidth="2" />
      <rect x="23.5" y="13.5" width="2.5" height="5" rx="1" fill="#c6f432" />
      <path d="M16.2 11.8l-4 5.2h3.2l-.9 3.6 4-5.2h-3.2z" fill="#c6f432" />
    </svg>
  );
}

export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className={dark ? "ring-1 ring-white/10 rounded-lg" : undefined} />
      <span className={cn("text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-zinc-900")}>
        Battery<span className={dark ? "text-volt" : "text-brand-700"}>OS</span>
      </span>
    </div>
  );
}
