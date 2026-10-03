import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { TitleBlock } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { sessionQuery } from "~/features/auth/api";
import { useChangePassword } from "~/features/auth/hooks/useChangePassword";
import { useLogout } from "~/features/auth/hooks/useLogout";
import { useThemeChoice } from "~/features/common/theme/hooks";
import { THEME_OPTIONS } from "~/features/common/theme/utils";
import { useDisplay } from "~/features/common/display/hooks";
import { DENSITY_OPTIONS, SIZE_OPTIONS } from "~/features/common/display/utils";
import { SettingsCard } from "~/features/settings/components/SettingsCard";

/** Settings → Account: who's signed in, how the dashboard looks, change password, sign out. */
export function AccountSettings() {
  const { data: session } = useQuery(sessionQuery);
  const logout = useLogout();
  const navigate = useNavigate();

  if (session && !session.auth_enabled)
    return (
      <>
        <SettingsCard padded className="gap-2">
          <TitleBlock title="Account" />
          <p className="m-0 text-sm text-ink-muted">
            This server doesn't ask anyone to sign in, so there's no account to manage here.
          </p>
        </SettingsCard>
        <Appearance />
      </>
    );

  return (
    <>
      <SettingsCard padded className="flex-row flex-wrap items-center justify-between gap-4">
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
      </SettingsCard>
      <Appearance />
      <ChangePassword />
    </>
  );
}

/** One choice in the Appearance card: what it is and what it does, with its control on the right. */
function Choice({ id, title, help, children }: { id: string; title: string; help: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-subtle px-7 py-5 max-sm:px-5">
      <div className="flex max-w-[560px] min-w-[220px] flex-1 flex-col gap-0.5">
        <span id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </span>
        <span className="text-[13px] leading-5 text-pretty text-ink-muted">{help}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * How the dashboard looks in this browser: its theme, size, layout, contrast and motion. Kept per
 * browser, so a phone and a wall-mounted tablet can each be set their own way.
 */
function Appearance() {
  const [theme, setTheme] = useThemeChoice();
  const [display, setDisplay] = useDisplay();
  const motionHelp =
    "Stops the page animations and moving charts. It's always on when your device asks for less motion.";
  return (
    <SettingsCard aria-labelledby="h-theme">
      <div className="p-7 max-sm:p-5">
        <TitleBlock
          id="h-theme"
          title="Appearance"
          sub="Saved in this browser, so each device can be set its own way."
        />
      </div>
      <Choice id="c-theme" title="Theme" help="System matches your device's light or dark setting.">
        <Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
      </Choice>
      <Choice
        id="c-size"
        title="Size"
        help="Text, spacing and charts together. Smaller fits more on the screen; larger is easier to read."
      >
        <Segmented label="Size" options={SIZE_OPTIONS} value={display.size} onChange={(size) => setDisplay({ size })} />
      </Choice>
      <Choice
        id="c-density"
        title="Layout"
        help="Compact tightens the space in and between cards and shortens the charts, for less scrolling."
      >
        <Segmented
          label="Layout"
          options={DENSITY_OPTIONS}
          value={display.density}
          onChange={(density) => setDisplay({ density })}
        />
      </Choice>
      <Choice id="c-contrast" title="More contrast" help="Makes secondary text and dividing lines stronger.">
        <Switch
          on={display.contrast === "more"}
          onChange={(on) => setDisplay({ contrast: on ? "more" : "default" })}
          aria-labelledby="c-contrast"
        />
      </Choice>
      <Choice id="c-motion" title="Reduce motion" help={motionHelp}>
        <Switch
          on={display.motion === "reduce"}
          onChange={(on) => setDisplay({ motion: on ? "reduce" : "system" })}
          aria-labelledby="c-motion"
        />
      </Choice>
    </SettingsCard>
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
      className="flex min-w-0 flex-col gap-6 rounded-3xl border border-line-subtle bg-surface p-7 max-sm:rounded-[20px] max-sm:p-5"
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
