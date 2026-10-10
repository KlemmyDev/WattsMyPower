import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { longDate, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { intAU, kWh, plural } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { ProgressBar, Spinner } from "~/features/common/ui/components/Progress";
import { Switch } from "~/features/common/ui/components/Switch";
import { STORE_IMPORT_WEATHER, store } from "~/features/common/storage/utils";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { previewImport, runImport } from "~/features/imports/api";
import type { ColumnChoices, ImportPreview } from "~/features/imports/types";
import { dayStatus, fileKey, intervalLabel, mergeDays, replacing, toWriteOn } from "~/features/imports/utils";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { weatherStatusQuery } from "~/features/weather/api";
import { useFetchWeather, WeatherFetchProgress } from "~/features/weather/components/WeatherFetch";
import { ButtonLink } from "~/features/common/ui/components/Button";

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

/** Manage → Integrations → Sungrow → Import: pick iSolarCloud exports, check what they hold, and import them. */
export function ImportUpload() {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [choices, setChoices] = useState<ColumnChoices>({});
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Fetch the imported days' weather once they're in (remembered in this browser; on unless switched off).
  const [withWeather, setWithWeather] = useState(() => store.get(STORE_IMPORT_WEATHER) !== "off");
  const [importedAt, setImportedAt] = useState<number | null>(null);
  // For days WattsMyPower already recorded: keep what it recorded and fill the gaps, or use the file's readings.
  const [replace, setReplace] = useState(false);
  const fetchWeather = useFetchWeather();
  const { data: weather } = useQuery(weatherStatusQuery);
  const locationSet = weather?.location_set ?? true;

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
  const reading = previews.filter((q) => q.isPending).length;
  const readyKeys = ready.map((r) => fileKey(r.file));
  const days = mergeDays(ready.map((r) => r.preview));
  const toWrite = days.reduce((n, d) => n + toWriteOn(d, replace), 0);
  const recorded = days.reduce((n, d) => n + d.recorded, 0);
  const daysToWrite = days.filter((d) => toWriteOn(d, replace) > 0).length;
  // Days the dashboard recorded (some or all of), which the file could replace; today never is.
  const overlap = days.filter((d) => d.recorded > 0 && !d.locked);
  const replacedDays = days.filter((d) => replacing(d, replace)).length;
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
    setReplace(false);
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
        const result = await runImport(file, choices, into, label, replace);
        into = result.import_id ?? into;
        written += result.written;
      }
      return written;
    },
    onSuccess: (written) => {
      toast(
        written
          ? `Imported ${daysToWrite} ${plural(daysToWrite, "day")} of history${replacedDays ? `, replacing what was recorded on ${replacedDays}` : ""}.`
          : "Nothing new to import.",
      );
      clear();
      qc.invalidateQueries(); // history, daily totals, insights, bills and costs all read the rollups
      if (written && withWeather && locationSet)
        fetchWeather.mutate(false, { onSuccess: (r) => setImportedAt(r.backfill.started_at ?? 0) });
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
                {q?.isPending && (
                  <span className="flex items-center gap-1.5 text-ink-faint">
                    <Spinner size={14} />
                    Reading…
                  </span>
                )}
                {run.isPending && progress != null && readyKeys.indexOf(fileKey(f)) === progress && (
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <Spinner size={14} />
                    Importing…
                  </span>
                )}
                {run.isPending &&
                  progress != null &&
                  readyKeys.indexOf(fileKey(f)) >= 0 &&
                  readyKeys.indexOf(fileKey(f)) < progress && (
                    <span className="flex items-center gap-1 text-good">
                      <Icon name="check" size={14} />
                      Imported
                    </span>
                  )}
                {q?.data && !run.isPending && (
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
              {days[0].date.slice(0, 4)}
              {days.length > 1 &&
                ` to ${shortDay.format(parseYmd(days[days.length - 1].date))} ${days[days.length - 1].date.slice(0, 4)}`}
            </span>
            <span className="text-xs text-ink-muted tabular-nums">
              {intAU(toWrite)} 5-minute readings to import
              {recorded > 0 &&
                (replace && replacedDays
                  ? `, including ${intAU(days.reduce((n, d) => n + (replacing(d, true) ? d.recorded : 0), 0))} WattsMyPower recorded`
                  : `, ${intAU(recorded)} already recorded by WattsMyPower (kept)`)}
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
                  const s = dayStatus(d, replace);
                  return (
                    <tr key={d.date} className="border-t border-line-subtle">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {shortDay.format(parseYmd(d.date))} {d.date.slice(0, 4)}
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

      {overlap.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-line-subtle p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">
              WattsMyPower already recorded{" "}
              {days.length === 1
                ? "this day"
                : overlap.length === days.length
                  ? "these days"
                  : `${overlap.length} of these days`}
            </span>
            <span className="text-[13px] text-pretty text-ink-muted">
              {overlap.length === 1
                ? `${shortDay.format(parseYmd(overlap[0].date))}: ${overlap[0].recorded >= overlap[0].buckets ? "all of it" : `${Math.round((overlap[0].recorded / overlap[0].buckets) * 100)}% of the file's readings`}.`
                : `From ${shortDay.format(parseYmd(overlap[0].date))} to ${shortDay.format(parseYmd(overlap[overlap.length - 1].date))}.`}{" "}
              Keep what it recorded and fill only the gaps, or use the file's readings for{" "}
              {overlap.length === 1 ? "that day" : "those days"} when what was recorded is incomplete or wrong.
            </span>
          </div>
          <Segmented
            label="For days already recorded"
            options={[
              { value: "keep", label: "Keep what was recorded" },
              { value: "replace", label: "Use the file's readings" },
            ]}
            value={replace ? "replace" : "keep"}
            onChange={(v) => setReplace(v === "replace")}
            className="w-fit max-sm:w-full"
            buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-3"
          />
          <HelpText>
            {replace
              ? "The file's readings are used wherever it has them. Removing this import later puts back what WattsMyPower recorded."
              : "Only the 5-minute steps WattsMyPower missed are taken from the file."}
            {days.some((d) => d.locked && d.recorded > 0) && " Today is still being recorded, so it's never replaced."}
          </HelpText>
        </div>
      )}

      {reading > 0 && !run.isPending && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Spinner />
            Reading {reading} {plural(reading, "file")}…
          </span>
          <ProgressBar label="Reading files" />
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-start gap-3">
          <Switch
            on={withWeather && locationSet}
            onChange={(on) => {
              setWithWeather(on);
              store.set(STORE_IMPORT_WEATHER, on ? "on" : "off");
            }}
            disabled={run.isPending || !locationSet}
            label="Fetch the weather for these days"
          />
          <div className="flex flex-col items-start gap-0.5">
            <span className="text-sm font-medium">Fetch the weather for these days</span>
            <span className="text-[13px] text-ink-muted">
              {locationSet
                ? "From Open-Meteo, straight after importing, however long ago they were, so History shows each day's weather and the forecast can learn from them."
                : "Choose your location first, so the weather is fetched for the right place. Days imported before then get theirs once it's set."}
            </span>
            {!locationSet && (
              <ButtonLink to="/integrations/weather" variant="link" size="sm" className="mt-1">
                Choose your location
              </ButtonLink>
            )}
          </div>
        </div>
      )}

      {run.isPending && progress != null && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Spinner />
            Importing {ready.length > 1 ? `file ${progress + 1} of ${ready.length}` : ready[0]?.file.name}…
          </span>
          <ProgressBar value={ready.length > 1 ? progress / ready.length : undefined} label="Importing files" />
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

      {importedAt != null && files.length === 0 && (
        <WeatherFetchProgress since={importedAt} className="border-t border-line-subtle pt-5" />
      )}
      {fetchWeather.isError && <HelpText tone="bad">{errorMessage(fetchWeather.error)}</HelpText>}
    </SettingsCard>
  );
}
