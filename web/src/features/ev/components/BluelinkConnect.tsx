import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { useBluelinkChange } from "~/features/ev/hooks";
import type { BluelinkBrand, BluelinkStatus } from "~/features/ev/types";

/**
 * Signing in to Hyundai's Bluelink or Kia Connect: the make, the app's email and password, the country the account's
 * in (Kia in New Zealand too), and the app's PIN (newer cars need it to start and stop charging), checked by reading
 * the account's cars.
 */
export function BluelinkConnect({
  status,
  className,
  onConnected,
}: {
  status: BluelinkStatus;
  className?: string;
  onConnected?: (s: BluelinkStatus) => void;
}) {
  const { connect } = useBluelinkChange();
  const [brand, setBrand] = useState<BluelinkBrand>(status.brand ?? "hyundai");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const regions = status.regions.filter((r) => r.brands.includes(brand));
  const [regionChoice, setRegion] = useState(status.region ?? "AU");
  const region = regions.some((r) => r.code === regionChoice) ? regionChoice : (regions[0]?.code ?? "AU");
  const app = status.brands.find((b) => b.code === brand)?.app ?? "Bluelink";
  const pinOk = pin === "" || /^\d{4}$/.test(pin);
  const ready = !!username.trim() && !!password && pinOk;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready)
      connect.mutate(
        { username: username.trim(), password, pin, brand, region },
        {
          onSuccess: (s) => {
            setPassword("");
            setPin("");
            onConnected?.(s);
          },
        },
      );
  };
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-4", className)}>
      <Segmented
        label="Make"
        options={status.brands.map((b) => ({ value: b.code, label: b.name }))}
        value={brand}
        onChange={setBrand}
        className="self-start"
        buttonClassName="px-4"
      />
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Email">
          <Input
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            invalid={connect.isError}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={connect.isError}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Country">
          <Select value={region} onChange={(e) => setRegion(e.target.value)}>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="App PIN (optional)">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            invalid={!pinOk}
          />
        </Field>
      </div>
      <HelpText>
        {status.mock
          ? "Mock mode: any email and password connects a made-up 2023 Ioniq 5."
          : `The ones you sign in to the ${app} app with, and the 4-digit PIN it asks for before a command. Newer cars (an Ioniq 5 from 2024, an EV9, an EV5…) need the PIN to start and stop charging; older ones don't. They're kept on this server and only ever sent to ${brand === "kia" ? "Kia" : "Hyundai"}.`}
      </HelpText>
      {connect.isError && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
      <Button type="submit" size="sm" className="self-start" disabled={!ready || connect.isPending}>
        {connect.isPending ? `Signing in to ${app}…` : "Connect"}
      </Button>
    </form>
  );
}
