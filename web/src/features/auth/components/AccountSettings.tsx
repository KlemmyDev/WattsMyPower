import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { TitleBlock } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { sessionQuery } from "~/features/auth/api";
import { useChangePassword } from "~/features/auth/hooks/useChangePassword";
import { useLogout } from "~/features/auth/hooks/useLogout";
import { useThemeChoice } from "~/features/common/theme/hooks";
import { THEME_OPTIONS } from "~/features/common/theme/utils";

/** Settings → Account: who's signed in, how the dashboard looks, change password, sign out. */
export function AccountSettings() {
  const { data: session } = useQuery(sessionQuery);
  const logout = useLogout();
  const navigate = useNavigate();

  if (session && !session.auth_enabled)
    return (
      <>
        <section className="flex max-w-[880px] flex-col gap-2 rounded-3xl border border-line-subtle bg-surface p-7">
          <TitleBlock title="Account" />
          <p className="m-0 text-sm text-ink-muted">
            This server doesn't ask anyone to sign in, so there's no account to manage here.
          </p>
        </section>
        <Appearance />
      </>
    );

  return (
    <>
      <section className="flex max-w-[880px] flex-wrap items-center justify-between gap-4 rounded-3xl border border-line-subtle bg-surface p-7">
        <TitleBlock title="Account" sub={session?.username ? `Signed in as ${session.username}` : undefined} />
        <Button
          variant="outline"
          disabled={logout.isPending}
          onClick={async () => {
            await logout.mutateAsync();
            navigate({ to: "/login", replace: true });
          }}
        >
          Sign out
        </Button>
      </section>
      <Appearance />
      <ChangePassword />
    </>
  );
}

/** Light, dark, or whatever the device uses. It's kept in this browser, so each device can differ. */
function Appearance() {
  const [theme, setTheme] = useThemeChoice();
  return (
    <section
      aria-labelledby="h-theme"
      className="flex max-w-[880px] flex-wrap items-center justify-between gap-4 rounded-3xl border border-line-subtle bg-surface p-7"
    >
      <TitleBlock
        id="h-theme"
        title="Appearance"
        sub="Saved in this browser. System matches your device's light or dark setting."
      />
      <Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
    </section>
  );
}

function ChangePassword() {
  const change = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) return setError("The new passwords don't match.");
    try {
      await change.mutateAsync({ current, new: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast("Password changed. Other browsers have been signed out.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="h-pw"
      className="flex max-w-[880px] flex-col gap-6 rounded-3xl border border-line-subtle bg-surface p-7"
    >
      <TitleBlock id="h-pw" title="Change password" sub="Changing it signs out every other browser." />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" help="At least 8 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
        <HelpText tone="bad" role="alert">
          {error}
        </HelpText>
        <Button type="submit" size="sm" disabled={change.isPending} className="ml-auto">
          Change password
        </Button>
      </div>
    </form>
  );
}
