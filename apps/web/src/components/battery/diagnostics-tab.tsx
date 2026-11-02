"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FlaskConical, Info, LineChart as LineIcon, Sigma, TableProperties } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

import { KindBadge, SeverityBadge } from "@/components/badges";
import { Tooltip } from "@/components/overlay";
import { ButtonLink, Callout, Card, CardHeader, EmptyState, LoadingBlock, Mono, Select, Table, TD, TH, THead, TR } from "@/components/ui";
import { api, apiUrl } from "@/lib/api";
import { cn, formatDateTime, formatNumber, label, TEST_TYPE_LABELS } from "@/lib/format";
import type { Battery, Dataset, Measurement, Series, TestSession } from "@/lib/types";

const SERIES_META: Record<string, { label: string; unit: string; color: string }> = {
  voltage_v: { label: "Pack voltage", unit: "V", color: "#0f766e" },
  current_a: { label: "Current", unit: "A", color: "#6366f1" },
  temperature_c: { label: "Temperature", unit: "°C", color: "#ea580c" },
  soc_pct: { label: "State of charge (reported)", unit: "%", color: "#0284c7" },
  power_w: { label: "Power", unit: "W", color: "#a21caf" },
  capacity_ah: { label: "Capacity counter", unit: "Ah", color: "#65a30d" },
  energy_wh: { label: "Energy counter", unit: "Wh", color: "#ca8a04" },
};

function timeScale(maxSeconds: number) {
  if (maxSeconds > 3 * 3600) return { div: 3600, unit: "h" };
  if (maxSeconds > 3 * 60) return { div: 60, unit: "min" };
  return { div: 1, unit: "s" };
}

function ChartCard({
  title,
  description,
  data,
  keys,
  rightKeys = [],
  xUnit,
  height = 260,
  colors,
  highlight,
}: {
  title: string;
  description?: string;
  data: Record<string, number | null>[];
  keys: string[];
  rightKeys?: string[];
  xUnit: string;
  height?: number;
  colors?: Record<string, string>;
  highlight?: string | null;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const all = [...keys, ...rightKeys];
  const nameOf = (k: string) => SERIES_META[k]?.label ?? k.replace(/^cell_voltage_(\d+)_v$/, "Cell $1").replace(/^temperature_(\d+)_c$/, "Temperature $1");
  const unitOf = (k: string) => SERIES_META[k]?.unit ?? (k.startsWith("cell_") ? "V" : k.startsWith("temperature") ? "°C" : "");
  const colorOf = (k: string) => colors?.[k] ?? SERIES_META[k]?.color ?? "#71717a";
  return (
    <Card>
      <CardHeader icon={<LineIcon />} title={title} description={description} />
      <div className="px-2 pb-3 pt-4 sm:px-4">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 4, right: rightKeys.length ? 4 : 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#f4f4f5" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatNumber(v, null, 1)}
              tick={{ fontSize: 11, fill: "#71717a" }}
              tickLine={false}
              axisLine={{ stroke: "#e4e4e7" }}
              label={{ value: `Elapsed time (${xUnit})`, position: "insideBottomRight", offset: -2, fontSize: 11, fill: "#a1a1aa" }}
              height={34}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} tickFormatter={(v) => formatNumber(v, null, 2)} />
            {rightKeys.length ? (
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} tickFormatter={(v) => formatNumber(v, null, 1)} />
            ) : null}
            <RTooltip
              contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12, boxShadow: "0 8px 24px -12px rgba(0,0,0,.25)" }}
              labelFormatter={(v) => `t = ${formatNumber(Number(v), xUnit, 3)}`}
              formatter={(value: any, name: any) => [formatNumber(Number(value), unitOf(String(name)), 4), nameOf(String(name))]}
            />
            {all.length <= 8 ? (
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 6, cursor: "pointer" }}
                formatter={(k: any) => <span className={hidden.has(String(k)) ? "text-zinc-300 line-through" : "text-zinc-600"}>{nameOf(String(k))}</span>}
                onClick={(e: any) => {
                  const k = String(e.dataKey);
                  setHidden((h) => {
                    const n = new Set(h);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  });
                }}
              />
            ) : null}
            {all.map((k) => (
              <Line
                key={k}
                yAxisId={rightKeys.includes(k) ? "right" : "left"}
                type="linear"
                dataKey={k}
                stroke={colorOf(k)}
                strokeWidth={highlight === k ? 2.2 : all.length > 8 ? 1 : 1.6}
                strokeOpacity={highlight && highlight !== k ? 0.45 : 1}
                dot={false}
                hide={hidden.has(k)}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DatasetView({ dataset, sessions }: { dataset: Dataset; sessions: TestSession[] }) {
  const series = useQuery({
    queryKey: ["series", dataset.id],
    queryFn: () => api<Series>(`/datasets/${dataset.id}/series`, { params: { max_points: 1500 } }),
  });
  const s = series.data;
  const prepared = useMemo(() => {
    if (!s) return null;
    const t = s.series.t_s ?? [];
    const maxT = Math.max(0, ...t.filter((x): x is number => x !== null));
    const scale = timeScale(maxT);
    const keys = Object.keys(s.series).filter((k) => k !== "t_s");
    const rows = t.map((tv, i) => {
      const row: Record<string, number | null> = { t: tv === null ? null : tv / scale.div };
      for (const k of keys) row[k] = s.series[k][i];
      return row;
    });
    return { rows, keys, unit: scale.unit };
  }, [s]);

  const metrics = dataset.summary?.metrics ?? [];
  const lowest = metrics.find((m) => m.key === "cell_lowest_index")?.value;
  const issues = dataset.validation?.issues ?? [];
  const session = sessions.find((x) => x.id === dataset.test_session_id);

  const cellKeys = prepared?.keys.filter((k) => k.startsWith("cell_voltage_")) ?? [];
  const tempKeys = prepared?.keys.filter((k) => k.startsWith("temperature")) ?? [];
  const has = (k: string) => prepared?.keys.includes(k);
  const cellColors = Object.fromEntries(
    cellKeys.map((k, i) => [k, `hsl(${(i * 360) / Math.max(1, cellKeys.length)} 55% 45%)`]),
  );
  const lowestKey = lowest ? `cell_voltage_${lowest}_v` : null;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{dataset.upload.original_filename}</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {dataset.imported_rows.toLocaleString("en-IN")} rows imported of {dataset.row_count.toLocaleString("en-IN")} · imported by{" "}
              {dataset.imported_by?.full_name} on {formatDateTime(dataset.imported_at)}
              {session ? ` · test session: ${label(TEST_TYPE_LABELS, session.test_type)} (${session.test_date})` : " · not linked to a test session"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <a className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50" href={apiUrl(`/datasets/${dataset.id}/normalized.csv`)}>
              <Download className="size-4" /> Normalized CSV
            </a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50" href={apiUrl(`/uploads/${dataset.upload.id}/download`)}>
              <Download className="size-4" /> Original file
            </a>
          </div>
        </div>
      </Card>

      {series.isLoading || !prepared ? (
        <Card className="p-5">
          <LoadingBlock rows={5} />
        </Card>
      ) : (
        <>
          {s?.downsampled ? (
            <p className="-mb-3 flex items-center gap-1.5 text-xs text-zinc-500">
              <Info className="size-3.5" />
              Charts show {s.returned_points.toLocaleString("en-IN")} of {s.total_points.toLocaleString("en-IN")} points ({s.method}). Calculated values use every point.
            </p>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            {has("voltage_v") || has("current_a") ? (
              <ChartCard
                title="Pack voltage and current"
                description="Current is shown with charge positive and discharge negative."
                data={prepared.rows}
                keys={has("voltage_v") ? ["voltage_v"] : []}
                rightKeys={has("current_a") ? ["current_a"] : []}
                xUnit={prepared.unit}
              />
            ) : null}
            {tempKeys.length || has("soc_pct") ? (
              <ChartCard
                title={tempKeys.length && has("soc_pct") ? "Temperature and reported SOC" : tempKeys.length ? "Temperature" : "Reported state of charge"}
                description={has("soc_pct") ? "SOC is as reported by the source device, not estimated by BatteryOS." : `${tempKeys.length} temperature sensor${tempKeys.length === 1 ? "" : "s"}.`}
                data={prepared.rows}
                keys={tempKeys}
                rightKeys={has("soc_pct") ? ["soc_pct"] : []}
                xUnit={prepared.unit}
                colors={Object.fromEntries(tempKeys.map((k, i) => [k, i === 0 ? "#ea580c" : ["#f59e0b", "#dc2626", "#b45309"][i % 3]]))}
              />
            ) : null}
          </div>
          {cellKeys.length ? (
            <ChartCard
              title={`Cell voltages (${cellKeys.length} cells)`}
              description={lowestKey ? `Cell ${lowest} has the lowest single reading and is drawn thicker.` : undefined}
              data={prepared.rows}
              keys={cellKeys}
              xUnit={prepared.unit}
              height={300}
              colors={cellColors}
              highlight={lowestKey}
            />
          ) : null}
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            icon={<Sigma />}
            title="Calculated from this file"
            description="Computed by BatteryOS from the imported points. Hover a method to see how."
            actions={<KindBadge kind="calculated" />}
          />
          <Table>
            <tbody>
              {metrics.map((m) => (
                <TR key={m.key}>
                  <TD className="text-zinc-600">
                    <Tooltip content={m.method}>
                      <span className="cursor-help border-b border-dotted border-zinc-300">{m.label}</span>
                    </Tooltip>
                  </TD>
                  <TD className="tabular text-right font-medium text-zinc-900">{formatNumber(m.value, m.unit, 3)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 sm:px-5">
            Charge throughput is not a capacity result unless the recorded test was a controlled full discharge. Record capacity test results in
            Tests &amp; notes with their conditions.
          </p>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              icon={<AlertTriangle />}
              title="Validation at import"
              description={`${issues.filter((i) => i.severity === "warning").length} warning(s) were acknowledged by ${dataset.imported_by?.full_name ?? "the importer"}.`}
            />
            {issues.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500 sm:p-5">No issues were found.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto scrollbar-thin">
                {issues.map((i, n) => (
                  <li key={n} className="flex gap-2.5 px-4 py-2.5 text-sm sm:px-5">
                    <SeverityBadge severity={i.severity} />
                    <span className="text-zinc-700">{i.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<TableProperties />} title="Column mapping used" />
            <Table>
              <THead>
                <tr>
                  <TH>Column in file</TH>
                  <TH>Imported as</TH>
                  <TH>Unit</TH>
                </tr>
              </THead>
              <tbody>
                {dataset.column_mapping.map((m) => (
                  <TR key={m.column}>
                    <TD>
                      <Mono>{m.column}</Mono>
                    </TD>
                    <TD>{m.field.replace(/_/g, " ")}</TD>
                    <TD>
                      {m.unit}
                      {m.unit_source === "assumed" ? <span className="ml-1 text-xs text-amber-700">(assumed)</span> : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function DiagnosticsTab({ battery }: { battery: Battery }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const datasets = useQuery({ queryKey: ["datasets", battery.id], queryFn: () => api<Dataset[]>(`/batteries/${battery.id}/datasets`) });
  const sessions = useQuery({ queryKey: ["test-sessions", battery.id], queryFn: () => api<TestSession[]>(`/batteries/${battery.id}/test-sessions`) });
  const measurements = useQuery({ queryKey: ["measurements", battery.id], queryFn: () => api<Measurement[]>(`/batteries/${battery.id}/measurements`) });
  const selectedId = params.get("dataset") ?? datasets.data?.[0]?.id;
  const selected = datasets.data?.find((d) => d.id === selectedId) ?? datasets.data?.[0];
  const results = (measurements.data ?? []).filter((m) => !m.voided_at);
  const hasModel = results.some((m) => m.kind === "model_estimate");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Recorded results" description="Measured, external and estimated values with their source. Manage them in Tests & notes." />
          {results.length === 0 ? (
            <EmptyState className="py-8" title="No results recorded" description="Capacity, internal resistance and other results appear here once recorded." />
          ) : (
            <Table>
              <tbody>
                {results.map((m) => (
                  <TR key={m.id}>
                    <TD className="text-zinc-600">{m.label}</TD>
                    <TD className="tabular font-medium text-zinc-900">{m.value_num !== null ? formatNumber(m.value_num, m.unit, 4) : m.value_text}</TD>
                    <TD>
                      <KindBadge kind={m.kind} />
                    </TD>
                    <TD className="hidden max-w-64 truncate text-xs text-zinc-500 md:table-cell">{m.conditions ?? m.source_description ?? "Conditions not recorded"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className={cn("p-4 sm:p-5", hasModel ? "" : "bg-zinc-50/60")}>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <FlaskConical className="size-4 text-amber-600" /> Model estimates
          </div>
          {hasModel ? (
            <p className="mt-2 text-sm text-zinc-600">
              A model estimate is recorded for this battery and is labelled as an estimate wherever it appears, with its source.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              No validated model is configured for this battery. BatteryOS does not estimate state of health or remaining life without a model
              validated for this chemistry, pack design and operating conditions.
            </p>
          )}
        </Card>
      </div>

      {datasets.isLoading ? (
        <LoadingBlock rows={4} />
      ) : !datasets.data?.length ? (
        <Card>
          <EmptyState
            icon={<LineIcon />}
            title="No imported data yet"
            description="Upload a CSV export in Files & data, then preview and import it to see charts and calculated values here."
            action={
              <ButtonLink href={`/batteries/${battery.id}?tab=files`} variant="primary">
                Go to Files &amp; data
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <>
          {datasets.data.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Dataset</span>
              <Select
                value={selected?.id}
                onChange={(e) => {
                  const next = new URLSearchParams(params.toString());
                  next.set("dataset", e.target.value);
                  router.replace(`${pathname}?${next.toString()}`, { scroll: false });
                }}
                className="w-auto max-w-md"
              >
                {datasets.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.upload.original_filename} · {d.imported_rows} rows
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {selected ? <DatasetView key={selected.id} dataset={selected} sessions={sessions.data ?? []} /> : null}
        </>
      )}
      {datasets.isError ? <Callout tone="rose">Could not load datasets.</Callout> : null}
    </div>
  );
}
