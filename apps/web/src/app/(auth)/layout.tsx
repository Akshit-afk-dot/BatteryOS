import { FileSpreadsheet, ShieldCheck, Sparkles } from "lucide-react";

import { Logo } from "@/components/logo";

const POINTS = [
  {
    icon: FileSpreadsheet,
    title: "Intake to quotation in one record",
    text: "Register packs, attach BMS exports and photos, record tests, and quote — without spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Original data kept unchanged",
    text: "Every value is labelled as measured, entered, calculated or estimated, with where it came from.",
  },
  {
    icon: Sparkles,
    title: "AI drafts, people approve",
    text: "Reports and quotations are drafted from your records only. A qualified person reviews and signs off.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-zinc-950 p-10 text-zinc-300 lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(198,244,50,0.14),transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <Logo dark className="relative" />
        <div className="relative my-auto max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            The operations system for battery refurbishment.
          </h1>
          <p className="mt-3 text-[15px] text-zinc-400">
            Built for refurbishers, service centres and second-life battery operators.
          </p>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <p.icon className="size-4 text-volt" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-100">{p.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-zinc-500">
          BatteryOS is an operational record system, not a safety certification tool.
        </p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
