import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { BrandMark } from "~/features/common/ui/components/Icon";
import { sessionQuery } from "~/features/auth/api";
import { useCreateAccount } from "~/features/auth/hooks/useCreateAccount";
import { useLogin } from "~/features/auth/hooks/useLogin";

/** Sign in, or on first run create the household account. */
export function LoginPage({ redirectTo }: { redirectTo?: string }) {
  const { data: session } = useQuery(sessionQuery);
  const setup = !!session?.setup_required;
  const login = useLogin();
  const create = useCreateAccount();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const busy = login.isPending || create.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== confirm) return setError("The passwords don't match.");
    try {
      await (setup ? create : login).mutateAsync({ username, password });
      navigate({ to: redirectTo || "/", replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <form
        onSubmit={submit}
        className="flex w-full max-w-[400px] flex-col gap-6 rounded-3xl border border-line-subtle bg-surface p-8 max-sm:p-6"
        aria-labelledby="h-login"
      >
        <div className="flex flex-col items-start gap-5">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-fg/8 bg-linear-160 from-mark-from to-mark-to">
            <BrandMark />
          </span>
          <div className="flex flex-col gap-1">
            <h1 id="h-login" className="text-[32px] leading-10 tracking-[-0.8px]">
              {setup ? "Create your account" : "Sign in"}
            </h1>
            <p className="m-0 text-sm leading-[22px] text-pretty text-ink-muted">
              {setup
                ? "Choose a username and password for this dashboard. Anyone on your network will need them to see your data or change settings."
                : "Sign in to see your solar, battery and savings."}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Username">
            <Input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Password" help={setup ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={setup ? 8 : undefined}
            />
          </Field>
          {setup && (
            <Field label="Confirm password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>
          )}
          <HelpText tone="bad" role="alert">
            {error}
          </HelpText>
        </div>
        <Button type="submit" disabled={busy} className="justify-center">
          {busy ? (setup ? "Creating account…" : "Signing in…") : setup ? "Create account" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
