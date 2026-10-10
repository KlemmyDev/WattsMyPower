import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { dayMonth } from "~/features/common/formatting/utils/date";
import { kWhInt, plural } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import {
  importMeterFile,
  meterChanged,
  meterImportsQuery,
  previewMeterFile,
  removeMeterImport,
} from "~/features/meter/api";
import type { MeterImport, MeterPreview } from "~/features/meter/types";
import { channelLabel, dateSpan, intervalName, readings, ymdSpan } from "~/features/meter/utils";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const ROW = "border-b border-line-subtle px-6 py-5 last:border-b-0 max-sm:px-4";
// Channels other than each meter's general import and export, such as E2 controlled load: the retailer
// bills them at their own rate and the inverter doesn't see them, so they're kept but not counted.
const STORED_ONLY = "stored, not included in bills";

/** What a chosen file holds, with the button that imports it. */
function Preview({ file, preview, onDone }: { file: File; preview: MeterPreview; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => importMeterFile(file),
    onSuccess: (saved) => {
      toast(`Imported ${saved.days} ${plural(saved.days, "day")} of meter data.`);
      meterChanged(qc);
      onDone();
    },
  });
  const minutes = [...new Set(preview.channels.map((c) => c.minutes))];
  const multi = preview.nmis.length > 1;

  return (
    <div className={`flex flex-col gap-4 bg-canvas ${ROW}`}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold break-all">{preview.filename}</span>
        <span className="text-[13px] text-ink-muted">
          {ymdSpan(preview.first, preview.last)} · {preview.days} {plural(preview.days, "day")} of{" "}
          {minutes.map(intervalName).join(" and ")} readings · {plural(preview.nmis.length, "NMI")}{" "}
          {preview.nmis.join(", ")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 max-sm:gap-2">
        {(["import", "export"] as const).map((dir) => (
          <div key={dir} className="flex flex-col gap-0.5 rounded-xl bg-surface px-4 py-3">
            <span className="text-xs text-ink-muted">{dir === "import" ? "From the grid" : "To the grid"}</span>
            <span className="text-lg font-semibold tabular-nums">
              {preview.channels.some((c) => c.included && c.direction === dir)
                ? kWhInt(dir === "import" ? preview.import_kwh : preview.export_kwh)
                : "Not in this file"}
            </span>
          </div>
        ))}
      </div>
      <ul className="flex flex-col gap-1 text-[13px] leading-5 text-ink-muted">
        {preview.channels.map((c) => (
          <li key={`${c.nmi}-${c.suffix}`} className={c.included ? undefined : "text-ink-faint"}>
            <span className={c.included ? "font-medium text-ink" : undefined}>{channelLabel(c)}</span>
            {multi && ` on ${c.nmi}`}: {kWhInt(c.kwh)} ·{" "}
            {c.included ? (
              <>
                {readings(c.readings)} over {c.days} {plural(c.days, "day")}
                {c.estimated > 0 && `, ${c.estimated} estimated or substituted`}
                {c.missing > 0 && `, ${c.missing} missing`}
              </>
            ) : (
              STORED_ONLY
            )}
          </li>
        ))}
        {preview.missing > 0 && <li>Days with missing readings keep using the inverter's figures.</li>}
        {preview.replaces_days > 0 && (
          <li className="text-ink">
            Replaces {preview.replaces_days} {plural(preview.replaces_days, "day")} you've already imported.
          </li>
        )}
        {preview.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Importing…" : "Import"}
        </Button>
        <Button variant="muted-link" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
      {save.isError && <HelpText tone="bad">{errorMessage(save.error)}</HelpText>}
    </div>
  );
}

/** An imported file: what it covers, and removing it. */
function ImportRow({ item }: { item: MeterImport }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeMeterImport(item.id),
    onSuccess: () => {
      toast(`Removed ${item.filename}.`);
      meterChanged(qc);
    },
  });
  const span = dateSpan(item.start, item.end - 1);

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 ${ROW}`}>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          <span className="break-all">{item.filename}</span>
          {item.estimated > 0 && (
            <Pill size="sm" title="Readings the meter data provider estimated or substituted">
              {item.estimated} estimated
            </Pill>
          )}
        </div>
        <span className="text-[13px] text-ink-muted">
          {span} · imported {dayMonth(item.imported_at)}
        </span>
        <ul className="flex flex-col text-[13px] leading-5 text-ink-muted">
          {item.channels.map((c) => (
            <li key={`${c.nmi}-${c.suffix}`} className={c.included ? undefined : "text-ink-faint"}>
              {channelLabel(c)}
              {item.nmis.length > 1 && ` on ${c.nmi}`}: {kWhInt(c.kwh)}
              {!c.included && ` · ${STORED_ONLY}`}
            </li>
          ))}
        </ul>
      </div>
      {confirming ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? "Removing…" : "Remove it"}
          </Button>
          <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Remove
        </Button>
      )}
      {(confirming || remove.isError) && (
        <div className="basis-full">
          {remove.isError ? (
            <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>
          ) : (
            <HelpText>Bills and costs for its days go back to the inverter's figures.</HelpText>
          )}
        </div>
      )}
    </div>
  );
}

/** Bills → Rates & settings: import the smart meter's interval data (NEM12), see what's imported, and remove it. */
export function MeterDataSettings() {
  const { data: imports, isPending, error } = useQuery(meterImportsQuery);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const preview = useMutation({ mutationFn: previewMeterFile });

  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    preview.mutate(f);
  };
  const done = () => {
    setFile(null);
    preview.reset();
  };

  return (
    <SettingsCard aria-labelledby="h-meter">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle p-6 max-sm:px-4">
        <SettingsTitle
          id="h-meter"
          title="Smart meter data"
          sub="Your meter's own readings: what your retailer bills you on. Where they cover a day, bills and costs use them instead of the inverter's figures."
        />
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = ""; // so choosing the same file again still counts
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={preview.isPending}>
          {preview.isPending ? "Reading the file…" : "Upload a NEM12 file"}
        </Button>
      </div>
      {file && preview.isError && (
        <div className={`flex flex-col gap-1 ${ROW}`}>
          <span className="text-sm font-semibold break-all">{file.name}</span>
          <HelpText tone="bad" className="text-[13px] leading-5">
            {errorMessage(preview.error)}
          </HelpText>
        </div>
      )}
      {file && preview.data && <Preview file={file} preview={preview.data} onDone={done} />}
      {isPending && <div className={`text-sm text-ink-muted ${ROW}`}>Loading imports…</div>}
      {error && <div className={`text-sm text-bad ${ROW}`}>{errorMessage(error)}</div>}
      {imports?.map((item) => (
        <ImportRow key={item.id} item={item} />
      ))}
      {imports?.length === 0 && !file && (
        <div className={`text-[13px] leading-5 text-pretty text-ink-muted ${ROW}`}>
          Download your interval data as a NEM12 file (a CSV) from your electricity distributor's or retailer's website,
          often under "usage data" or "download my data". Importing a file again later replaces the days it covers, so
          newer data with fewer estimates is used.
        </div>
      )}
    </SettingsCard>
  );
}
