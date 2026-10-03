import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { longDate, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { intAU, kWh, plural } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { previewImport, runImport } from "~/features/imports/api";
import type { ColumnChoices, ImportPreview } from "~/features/imports/types";
import { dayStatus, fileKey, intervalLabel, mergeDays } from "~/features/imports/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const ACCEPT = ".csv,.xlsx,.xls,.txt";
/** The four flows, and the columns that can give each: one alone, or all of a group. Any one missing is worked out from the rest. */
const FLOWS: { name: string; from: string[][] }[] = [
  { name: "solar", from: [["pv"]] },
  { name: "home use", from: [["load"]] },
  { name: "the grid", from: [["grid"], ["import", "export"]] },
  { name: "the battery", from: [["battery"], ["charge", "discharge"]] },
];

/** Fields one column can stand in for, both ways: a signed column, or its pair of one-way columns. */
const COVERED_BY: Record<string, string[]> = {
  import: ["grid"],
  export: ["grid"],
  grid: ["import", "export"],
  charge: ["battery"],
  discharge: ["battery"],
  battery: ["charge", "discharge"],
};

/** What an unchosen field's empty option says: covered by another column, or worked out from the rest. */
function emptyLabel(field: string, preview: ImportPreview): string {
  const by = COVERED_BY[field];
  if (by?.every((f) => preview.mapping[f]?.length))
    return `Not needed: ${by.map((f) => preview.mapping[f].join(" + ")).join(" and ")} cover${by.length === 1 ? "s" : ""} it`;
  // The battery's level can't be worked out from the flows; the rest can, if only one is missing.
  return field === "soc" ? "Not in this file" : "Not in this file (worked out if it can be)";
}

/** Picking each field's column(s): what was matched, any other column, or none. */
function ColumnPicker({
  preview,
  choices,
  onChange,
}: {
  preview: ImportPreview;
  choices: ColumnChoices;
  onChange: (c: ColumnChoices) => void;
}) {
  const headers = preview.columns.map((c) => c.header);
  const mapped = new Set(Object.values(preview.mapping).flat());
  const unused = preview.columns.filter((c) => !mapped.has(c.header) && !/^(time|date)/i.test(c.header));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Columns</span>
      <div className="overflow-hidden rounded-2xl border border-line-subtle">
        {Object.entries(preview.fields).map(([field, label]) => {
          const current = preview.mapping[field] ?? [];
          const value = JSON.stringify(current);
          return (
            <div
              key={field}
              className="grid grid-cols-[minmax(140px,1fr)_2fr] items-center gap-4 border-b border-line-subtle px-5 py-2 text-sm last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1.5 max-sm:py-3"
            >
              <span className="font-medium">{label}</span>
              <Select
                aria-label={`Column for ${label}`}
                value={value}
                onChange={(e) => onChange({ ...choices, [field]: JSON.parse(e.target.value) as string[] })}
                className="h-10 min-w-0 text-sm"
              >
                <option value="[]">
                  {current.length || field in choices ? "Don't import" : emptyLabel(field, preview)}
                </option>
                {current.length > 1 && <option value={value}>{current.join(" + ")}</option>}
                {headers.map((h) => (
                  <option key={h} value={JSON.stringify([h])}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
      {unused.length > 0 && (
        <HelpText>Not imported: {unused.map((c) => c.header).join(", ")}. Pick one above if it should be.</HelpText>
      )}
    </div>
  );
}

/** Settings → Integrations → Sungrow → Import: pick iSolarCloud exports, check what they hold, and import them. */
export function ImportUpload() {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [choices, setChoices] = useState<ColumnChoices>({});
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const previews = useQueries({
    queries: files.map((file) => ({
      queryKey: ["imports", "preview", fileKey(file), choices],
      queryFn: () => previewImport(file, choices),
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    })),
  });
  const ready = previews.flatMap((q, i) => (q.data ? [{ file: files[i], preview: q.data }] : []));
  const failed = previews.flatMap((q, i) => (q.isError ? [{ file: files[i], error: errorMessage(q.error) }] : []));
  const loading = previews.some((q) => q.isPending);
  const days = mergeDays(ready.map((r) => r.preview));
  const toWrite = days.reduce((n, d) => n + d.new + d.replaces, 0);
  const recorded = days.reduce((n, d) => n + d.recorded, 0);
  const daysToWrite = days.filter((d) => d.new + d.replaces > 0).length;
  const first = ready[0]?.preview;
  const warnings = [...new Set(ready.flatMap((r) => r.preview.warnings))];
  const missing = first
    ? FLOWS.filter(({ from }) => !from.some((group) => group.every((f) => first.mapping[f]?.length))).map(
        (flow) => flow.name,
      )
    : [];

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    const seen = new Set(files.map(fileKey));
    setFiles([...files, ...[...list].filter((f) => !seen.has(fileKey(f)))]);
  };
  const clear = () => {
    setFiles([]);
    setChoices({});
    if (input.current) input.current.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const run = useMutation({
    mutationFn: async () => {
      const label =
        ready.length === 1
          ? ready[0].file.name
          : `${ready.length} files, ${longDate.format(parseYmd(days[0].date))} to ${longDate.format(parseYmd(days[days.length - 1].date))}`;
      let into: number | null = null;
      let written = 0;
      for (const [i, { file }] of ready.entries()) {
        setProgress(i);
        const result = await runImport(file, choices, into, label);
        into = result.import_id ?? into;
        written += result.written;
      }
      return written;
    },
    onSuccess: (written) => {
      toast(written ? `Imported ${daysToWrite} ${plural(daysToWrite, "day")} of history.` : "Nothing new to import.");
      clear();
      qc.invalidateQueries(); // history, daily totals, insights, bills and costs all read the rollups
    },
    onSettled: () => setProgress(null),
  });

  return (
    <SettingsCard padded aria-labelledby="h-import">
      <SettingsTitle
        id="h-import"
        title="Import history"
        sub="Add the days before WattsMyPower was set up, or fill gaps when it was offline, from iSolarCloud exports."
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-brand bg-brand-subtle" : "border-line bg-canvas",
        )}
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-surface text-ink">
          <Icon name="upload" size={22} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">Drop iSolarCloud exports here</span>
          <span className="text-[13px] text-ink-muted">Excel (.xlsx) or CSV. Pick as many files as you like.</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={run.isPending}>
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
          aria-label="iSolarCloud export files"
        />
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {files.map((f, i) => {
            const q = previews[i];
            return (
              <div key={fileKey(f)} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                {q?.isPending && <span className="text-ink-faint">Reading…</span>}
                {q?.data && (
                  <span className="text-ink-muted tabular-nums">
                    {q.data.days.length} {plural(q.data.days.length, "day")}, {intervalLabel(q.data.interval)}
                  </span>
                )}
                {q?.isError && <span className="text-bad">Can't import</span>}
                <Button
                  variant="muted-link"
                  size="sm"
                  disabled={run.isPending}
                  onClick={() => setFiles(files.filter((x) => x !== f))}
                  aria-label={`Remove ${f.name}`}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {failed.map(({ file, error }) => (
        <HelpText key={fileKey(file)} tone="bad" className="text-sm">
          {error.startsWith(file.name) ? error : `${file.name}: ${error}`}
        </HelpText>
      ))}

      {first && <ColumnPicker preview={first} choices={choices} onChange={setChoices} />}

      {(warnings.length > 0 || missing.length > 0) && (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-ink-muted">
          {missing.length > 0 && (
            <li>
              No column for {missing.join(", ")}.{" "}
              {missing.length === 1
                ? "It's worked out from the others."
                : "With more than one missing, those figures stay blank for these days."}
            </li>
          )}
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {days.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold">
              {days.length} {plural(days.length, "day")}, {shortDay.format(parseYmd(days[0].date))}{" "}
              {parseYmd(days[0].date).getFullYear()}
              {days.length > 1 &&
                ` to ${shortDay.format(parseYmd(days[days.length - 1].date))} ${parseYmd(days[days.length - 1].date).getFullYear()}`}
            </span>
            <span className="text-xs text-ink-muted tabular-nums">
              {intAU(toWrite)} 5-minute readings to import
              {recorded > 0 && `, ${intAU(recorded)} already recorded by WattsMyPower (kept)`}
            </span>
          </div>
          <div className="max-h-[340px] overflow-auto rounded-2xl border border-line-subtle">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead className="sticky top-0 bg-canvas text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Day</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Solar</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">Home</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">Import</th>
                  <th className="px-3 py-2.5 text-right font-semibold max-sm:hidden">Export</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const s = dayStatus(d);
                  return (
                    <tr key={d.date} className="border-t border-line-subtle">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {shortDay.format(parseYmd(d.date))} {parseYmd(d.date).getFullYear()}
                      </td>
                      <td className="px-3 py-2 text-right">{kWh(d.pv_kwh)}</td>
                      <td className="px-3 py-2 text-right max-sm:hidden">{kWh(d.load_kwh)}</td>
                      <td className="px-3 py-2 text-right max-sm:hidden">{kWh(d.import_kwh)}</td>
                      <td className="px-3 py-2 text-right max-sm:hidden">{kWh(d.export_kwh)}</td>
                      <td className="px-4 py-2 text-right">
                        <Pill tone={s.tone} size="sm">
                          {s.label}
                        </Pill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => run.mutate()} disabled={loading || run.isPending || !toWrite}>
            {run.isPending
              ? `Importing ${(progress ?? 0) + 1} of ${ready.length}…`
              : toWrite
                ? `Import ${daysToWrite} ${plural(daysToWrite, "day")}`
                : loading
                  ? "Reading files…"
                  : "Nothing new to import"}
          </Button>
          <Button variant="muted-link" onClick={clear} disabled={run.isPending}>
            Clear
          </Button>
          {run.isError && <HelpText tone="bad">{errorMessage(run.error)}</HelpText>}
        </div>
      )}
    </SettingsCard>
  );
}
