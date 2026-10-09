import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";
import { useEvChange } from "~/features/ev/hooks";
import type { TeslaStatus } from "~/features/ev/types";

/** The Tessie access token, checked by listing the account's cars. */
export function TessieConnect({
  className,
  onConnected,
}: {
  className?: string;
  onConnected?: (s: TeslaStatus) => void;
}) {
  const { connect } = useEvChange();
  const [token, setToken] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim())
      connect.mutate(token.trim(), {
        onSuccess: (status) => {
          setToken("");
          onConnected?.(status);
        },
      });
  };
  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-3", className)}>
      <Field
        label="Tessie access token"
        help={
          <>
            In Tessie, open{" "}
            <a href="https://dash.tessie.com/settings/api" target="_blank" rel="noreferrer">
              Settings → API
            </a>{" "}
            and choose Generate Access Token. It stays on this server and is never shown in full again.
          </>
        }
      >
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          invalid={connect.isError}
        />
      </Field>
      {connect.isError && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
      <Button type="submit" size="sm" className="self-start" disabled={!token.trim() || connect.isPending}>
        {connect.isPending ? "Checking with Tessie…" : "Connect"}
      </Button>
    </form>
  );
}
