import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { cn } from "~/features/common/ui/utils";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { pairing, teslaQuery } from "~/features/ev/api";
import { useEvChange } from "~/features/ev/hooks";
import type { KeyRole, TeslaStatus } from "~/features/ev/types";
import { ROLE_LABEL } from "~/features/ev/utils";

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

const ROLE_ABOUT: Record<KeyRole, string> = {
  charging_manager:
    "It can start, stop and set charging, and can't unlock or drive the car. It can't wake the car either: once the car's asleep, charging from solar waits until it wakes (as you use it, or from the Tesla app).",
  driver:
    "It can wake the car, as your phone key does, so charging from solar can start the car even after it's fallen asleep plugged in. Like a phone key, it could also unlock and drive the car.",
};

const STEPS = [
  "Park the car near the server: Bluetooth reaches about 10 m, less through walls.",
  "Enter its VIN, then sit in the car with your key card.",
  "When the car asks, tap the card on the reader on the centre console to add this server's key.",
];

/**
 * Pairing a Tesla over this server's Bluetooth, by its VIN. The server asks the car to add a key of its own, charging
 * only or as a driver (which can wake the car), which takes a tap of a key card in the car. Follows the pairing as it
 * goes: looking for the car, waiting for the tap, then paired or why not. `vin` and `role` start it filled in (pairing
 * a car again as a driver).
 */
export function BluetoothPair({
  className,
  onPaired,
  vin: givenVin = "",
  role: givenRole,
}: {
  className?: string;
  onPaired?: (s: TeslaStatus) => void;
  vin?: string;
  role?: KeyRole;
}) {
  const { data: status } = useQuery(teslaQuery);
  const { pair } = useEvChange();
  const [vin, setVin] = useState(givenVin);
  const [role, setRole] = useState<KeyRole>(givenRole ?? status?.bluetooth.role ?? "charging_manager");
  const [asked, setAsked] = useState<string | null>(null);
  const p = status?.bluetooth.pairing;
  // The pairing asked for here, or one under way (asked for before the page was opened, or elsewhere).
  const mine = p && (p.vin === asked || pairing(status)) ? p : null;
  const busy = pairing(status) || pair.isPending;
  const clean = vin.trim().toUpperCase();
  const reported = useRef<number | null>(null);

  useEffect(() => {
    if (mine?.step === "done" && status && reported.current !== mine.at) {
      reported.current = mine.at;
      onPaired?.(status);
    }
  }, [mine, status, onPaired]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!VIN.test(clean)) return;
    setAsked(clean);
    pair.mutate({ vin: clean, role });
  };

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-4", className)}>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-[13px] leading-5 text-ink-muted">
            <span className="flex size-5 flex-none items-center justify-center rounded-full bg-canvas text-[11px] font-semibold text-ink">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <Field
        label="Vehicle identification number (VIN)"
        help={
          status?.bluetooth.mock_vin ? (
            <>
              Mock mode: pair the made-up car,{" "}
              <button
                type="button"
                className="border-0 bg-transparent p-0 font-mono text-link"
                onClick={() => setVin(status.bluetooth.mock_vin ?? "")}
              >
                {status.bluetooth.mock_vin}
              </button>
              .
            </>
          ) : (
            "On the car's screen (Controls → Software), in the Tesla app, or at the base of the windscreen."
          )
        }
      >
        <Input
          autoComplete="off"
          spellCheck={false}
          maxLength={17}
          className="font-mono uppercase"
          value={vin}
          disabled={busy}
          onChange={(e) => setVin(e.target.value)}
          invalid={pair.isError || (clean.length === 17 && !VIN.test(clean))}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">The dashboard's key</span>
        <Segmented
          label="The dashboard's key"
          options={(["charging_manager", "driver"] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          value={role}
          onChange={setRole}
          buttonClassName="flex-1 justify-center"
        />
        <span className="text-[13px] leading-5 text-pretty text-ink-muted">{ROLE_ABOUT[role]}</span>
        {status?.bluetooth.role && role !== status.bluetooth.role && (
          <span className="text-[13px] leading-5 text-pretty text-ink-muted">
            This makes the server a new key, used once the car's taken it. Any other car paired over Bluetooth needs
            pairing again too, and you can remove the old key in the car (Controls → Locks).
          </span>
        )}
      </div>
      {pair.isError && <HelpText tone="bad">{errorMessage(pair.error)}</HelpText>}
      {mine?.step === "looking" && (
        <Notice tone="plain" className="flex items-center gap-3">
          <span className="live-dot" data-state="stale" />
          Looking for the car over Bluetooth…
        </Notice>
      )}
      {mine?.step === "tap" && (
        <Notice tone="info" className="flex items-center gap-3 text-ink">
          <span className="text-brand">
            <Icon name="bluetooth" size={20} />
          </span>
          <span>
            <b className="font-semibold">Tap your key card on the console now.</b> The car shows a request to add a key;
            it waits a couple of minutes.
          </span>
        </Notice>
      )}
      {mine?.step === "failed" && <Notice tone="bad">{mine.error}</Notice>}
      <Button type="submit" size="sm" className="self-start" disabled={!VIN.test(clean) || busy}>
        {busy ? "Pairing…" : mine?.step === "failed" ? "Try again" : "Pair"}
      </Button>
    </form>
  );
}
