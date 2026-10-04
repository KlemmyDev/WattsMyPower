import { useState, type FormEvent } from "react";
import { useSetLevel } from "~/features/car/hooks";
import type { CarLevel } from "~/features/car/types";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { intAU, pct } from "~/features/common/formatting/utils/number";
import { sameDay } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";

/** The car's level as a bar, with a tick at the level it's charged to. */
export function LevelBar({ soc, target, className }: { soc: number | null; target: number; className?: string }) {
  const fill = Math.max(0, Math.min(100, soc ?? 0));
  return (
    <div
      role="meter"
      aria-label="The car's charge"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={soc == null ? undefined : Math.round(soc)}
      aria-valuetext={soc == null ? "Not known" : `${Math.round(soc)}%, charged to ${target}%`}
      className={cn("relative h-2.5 w-full rounded-full bg-track", className)}
    >
      <div
        className="h-full rounded-full bg-good transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${fill}%` }}
      />
      <span
        aria-hidden
        title={`Charged to ${target}%`}
        className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-ink"
        style={{ left: `calc(${target}% - 1px)` }}
      />
    </div>
  );
}

/** Where the level comes from, in words: "You said 45% at 18:10, plus the planned charge since". */
export function levelSource(l: CarLevel, now: number): string {
  const at = sameDay(l.given_at, now)
    ? `at ${hhmm(l.given_at)}`
    : `on ${new Date(l.given_at * 1000).toLocaleDateString("en-AU", { weekday: "long" })}`;
  return `You said ${pct(l.given)} ${at}${l.charged ? ", plus planned charging since" : ""}`;
}

/** The range left, in words. */
export const rangeWords = (l: CarLevel) => `about ${intAU(l.km)} km of range`;

/** Give the car's charge now: one number and Save. */
export function LevelForm({
  initial,
  onDone,
  className,
}: {
  initial: number | null;
  onDone?: () => void;
  className?: string;
}) {
  const set = useSetLevel();
  const toast = useToast();
  const [v, setV] = useState(initial == null ? "" : String(Math.round(initial)));
  const n = Number(v);
  const ok = v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok)
      set.mutate(n, {
        onSuccess: () => {
          toast("The car's charge is updated.");
          onDone?.();
        },
      });
  };
  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-wrap items-center gap-2", className)}>
      <label className="flex items-center gap-2 text-[13px] font-semibold">
        The car's charge now
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          max="100"
          unit="%"
          autoFocus
          boxClassName="h-9 w-[104px]"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      </label>
      <Button type="submit" size="sm" disabled={!ok || set.isPending}>
        {set.isPending ? "Saving…" : "Save"}
      </Button>
      {onDone && (
        <Button variant="muted-link" size="sm" onClick={onDone}>
          Cancel
        </Button>
      )}
      {set.isError && <HelpText tone="bad">{errorMessage(set.error)}</HelpText>}
    </form>
  );
}
