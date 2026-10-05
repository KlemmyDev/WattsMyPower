import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Switch } from "~/features/common/ui/components/Switch";
import { useNow } from "~/features/common/time/hooks";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeRuleSettings } from "~/features/home/types";

const PROTECTED = new Set(["fridge", "freezer"]);

type Form = { start: string; stop: string; hours: boolean; from: string; until: string; price: string };

const formOf = (d: HomeDevice): Form => ({
  start: String((d.rule?.start_w ?? 1500) / 1000),
  stop: String((d.rule?.stop_w ?? 300) / 1000),
  hours: d.rule?.from != null,
  from: d.rule?.from ?? "09:00",
  until: d.rule?.until ?? "16:00",
  price: d.rule?.max_price != null ? String(Math.round(d.rule.max_price * 1000) / 10) : "",
});

/**
 * Running a switchable device on spare solar: on once the home has been sending enough to the grid for a few minutes,
 * off once it's drawing from it, optionally only between two times and never while power costs more than a limit.
 * Switching it by hand pauses the rule for the rest of the day. Not for a fridge or freezer.
 */
export function RuleCard({ device }: { device: HomeDevice }) {
  const { setRule, clearRule } = useHomeChange();
  const [form, setForm] = useState(() => formOf(device));
  const [error, setError] = useState("");
  const now = useNow(60_000);
  if (!device.can_switch || PROTECTED.has(device.kind) || device.now?.switched_on == null) return null;
  const r = device.rule;
  const set = (k: keyof Form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const rule = (enabled: boolean): HomeRuleSettings | null => {
    const start = Number(form.start) * 1000;
    const stop = Number(form.stop) * 1000;
    const price = form.price.trim() === "" ? null : Number(form.price) / 100;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || (price != null && !Number.isFinite(price))) return null;
    return {
      enabled,
      start_w: start,
      stop_w: stop,
      from: form.hours ? form.from : null,
      until: form.hours ? form.until : null,
      max_price: price,
    };
  };
  const save = (enabled: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    setError("");
    const next = rule(enabled);
    if (!next) return setError("Enter numbers, like 1.5 kW and 30c.");
    setRule.mutate({ id: device.id, rule: next });
  };
  const paused = r?.paused_until != null && r.paused_until > now;
  const failed = setRule.error ?? clearRule.error;
  return (
    <Card aria-labelledby="h-rule" className="col-span-12 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-[620px] flex-col gap-0.5">
          <h2 id="h-rule">Run on spare solar</h2>
          <span className="text-[13px] text-pretty text-ink-muted">
            Switch {device.name} on when you're sending solar to the grid, and off again when the house starts drawing
            from it, so it runs on what you'd otherwise export. Switching it yourself pauses this until tomorrow.
          </span>
        </div>
        {r && (
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            <Switch
              on={r.enabled}
              label={r.enabled ? "Turn the rule off" : "Turn the rule on"}
              disabled={setRule.isPending}
              onChange={(on) => save(on)()}
            />
            {r.enabled ? "On" : "Off"}
          </label>
        )}
      </div>
      {r && (
        <span className="text-sm text-ink-muted">
          {paused
            ? `Paused until tomorrow: ${device.name} was switched by hand.`
            : r.last
              ? `Last switched ${r.last.on ? "on" : "off"} at ${hhmm(r.last.at)}: ${r.last.why}.`
              : r.enabled
                ? "Waiting for spare solar."
                : "Off: it won't switch anything."}
        </span>
      )}
      <form onSubmit={save(r?.enabled ?? true)} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            On when sending at least
            <Input
              unit="kW"
              inputMode="decimal"
              value={form.start}
              onChange={(e) => set("start", e.target.value)}
              boxClassName="w-[150px]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Off when drawing at least
            <Input
              unit="kW"
              inputMode="decimal"
              value={form.stop}
              onChange={(e) => set("stop", e.target.value)}
              boxClassName="w-[150px]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
            Off above (optional)
            <Input
              unit="c/kWh"
              inputMode="decimal"
              placeholder="No limit"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              boxClassName="w-[150px]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-ink-muted">
            <Switch on={form.hours} label="Only between set times" onChange={(on) => set("hours", on)} />
            Only between
          </label>
          {form.hours && (
            <>
              <Input
                type="time"
                aria-label="From"
                value={form.from}
                onChange={(e) => set("from", e.target.value)}
                boxClassName="h-9 w-[150px]"
              />
              <span className="text-ink-muted">and</span>
              <Input
                type="time"
                aria-label="Until"
                value={form.until}
                onChange={(e) => set("until", e.target.value)}
                boxClassName="h-9 w-[150px]"
              />
            </>
          )}
        </div>
        <HelpText>
          Set "on" a little above what {device.name} draws
          {device.now?.power_w ? ` (about ${Math.round(device.now.power_w)} W when last read)` : ""}, so switching it on
          doesn't start drawing from the grid. It waits 10 minutes between switches.
        </HelpText>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={setRule.isPending}>
            {setRule.isPending ? "Saving…" : r ? "Save" : "Run it on spare solar"}
          </Button>
          {r && (
            <Button
              type="button"
              variant="muted-link"
              disabled={clearRule.isPending}
              onClick={() => clearRule.mutate(device.id)}
            >
              Remove the rule
            </Button>
          )}
          {(error || failed) && <HelpText tone="bad">{error || errorMessage(failed)}</HelpText>}
        </div>
      </form>
    </Card>
  );
}
