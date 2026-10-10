import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";
import { useBydChange } from "~/features/ev/hooks";
import type { BydStatus } from "~/features/ev/types";

/** Signing in to BYD with the BYD app's email and password (and the account's region), checked by reading its cars. */
export function BydConnect({
  status,
  className,
  onConnected,
}: {
  status: BydStatus;
  className?: string;
  onConnected?: (s: BydStatus) => void;
}) {
  const { connect } = useBydChange();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState(status.region ?? status.regions[0]?.code ?? "AU");
  const ready = !!username.trim() && !!password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready)
      connect.mutate(
        { username: username.trim(), password, region },
        {
          onSuccess: (s) => {
            setPassword("");
            onConnected?.(s);
          },
        },
      );
  };
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-4", className)}>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Email or phone number">
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
      <Field label="Region" className="max-w-xs">
        <Select value={region} onChange={(e) => setRegion(e.target.value)}>
          {status.regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <HelpText>
        {status.mock
          ? "Mock mode: any email and password connects a made-up Atto 3."
          : "The ones you sign in to the BYD app with. They're kept on this server and only ever sent to BYD. BYD signs an account in one place at a time, so this signs the app out on your phone: share the car to a second account from the BYD app and use that one here to avoid it."}
      </HelpText>
      {connect.isError && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
      <Button type="submit" size="sm" className="self-start" disabled={!ready || connect.isPending}>
        {connect.isPending ? "Signing in to BYD…" : "Connect"}
      </Button>
    </form>
  );
}
