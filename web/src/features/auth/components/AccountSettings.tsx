import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, Input } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { sessionQuery } from "~/features/auth/api";
import { useChangePassword } from "~/features/auth/hooks/useChangePassword";
import { useLogout } from "~/features/auth/hooks/useLogout";
import { useThemeChoice } from "~/features/common/theme/hooks";
import { COLOR } from "~/features/common/theme/utils/colors";
import type { ThemeChoice } from "~/features/common/theme/utils";
import { THEME_OPTIONS } from "~/features/common/theme/utils";
import { useDisplay } from "~/features/common/display/hooks";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import type { Clock, Density, Size } from "~/features/common/display/utils";
import { CLOCK_OPTIONS, DENSITY_OPTIONS, SIZE_OPTIONS } from "~/features/common/display/utils";
import {
  ChoiceTiles,
  OptionList,
  OptionRow,
  SaveBar,
  SettingsSection,
} from "~/features/settings/components/SettingsSection";

const label = <T extends string>(options: { value: T; label: string }[], v: T) =>
  options.find((o) => o.value === v)?.label ?? v;

/**
 * Settings → Account: who's signed in (and signing out) and how the dashboard looks in this browser at the top, then the
 * look chosen in pictures, the accessibility switches, and changing the password.
 */
export function AccountSettings() {
  const { data: session } = useQuery(sessionQuery);
  const logout = useLogout();
  const navigate = useNavigate();
  const [theme] = useThemeChoice();
  const [display] = useDisplay();
  const auth = session?.auth_enabled !== false;

  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings">Settings</BackLink>}
        id="h-account-page"
        title="Account"
        sub="Signing in, and how the dashboard looks in this browser."
      />
      <SummaryCard
        icon="user"
        color={COLOR.lilac}
        label="Your account"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1">
              {!session
                ? ""
                : auth
                  ? `Signed in as ${session.username ?? "you"}. Changing the password signs out every other browser.`
                  : "This server doesn't ask anyone to sign in, so there's no account to manage."}
            </span>
            {auth && session && (
              <Button
                variant="outline"
                size="sm"
                disabled={logout.isPending}
                onClick={async () => {
                  await logout.mutateAsync();
                  navigate({ to: "/login", replace: true });
                }}
              >
                Sign out
              </Button>
            )}
          </div>
        }
      >
        <SummaryStat
          label="Signed in as"
          value={!session ? "—" : auth ? (session.username ?? "—") : "No sign-in"}
          sub={auth ? "This browser" : "Handled elsewhere"}
        />
        <SummaryStat label="Theme" value={label(THEME_OPTIONS, theme)} sub="In this browser" />
        <SummaryStat
          label="Size"
          value={label(SIZE_OPTIONS, display.size)}
          sub={label(DENSITY_OPTIONS, display.density)}
        />
        <SummaryStat label="Clock" value={display.clock === "12" ? "12-hour" : "24-hour"} sub="For every time shown" />
      </SummaryCard>
      <Appearance />
      <Accessibility />
      {auth && session && <ChangePassword />}
    </>
  );
}

/** A small picture of the dashboard in a theme: a side bar, a heading and two cards. */
function ThemePane({ theme }: { theme: "light" | "dark" }) {
  const c =
    theme === "light"
      ? { bg: "#f4f4f5", nav: "#e8e8ec", card: "#ffffff", line: "#c9c9d1", accent: "#4157de" }
      : { bg: "#0a0a0a", nav: "#161618", card: "#1f1f22", line: "#3a3a40", accent: "#8fa6ff" };
  return (
    <span className="flex h-full flex-1 gap-1.5 p-2" style={{ background: c.bg }}>
      <span className="w-[18%] rounded-[5px]" style={{ background: c.nav }} />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <span className="flex flex-1 items-end rounded-[5px] p-1.5" style={{ background: c.card }}>
          <span className="h-1.5 w-2/3 rounded-full" style={{ background: c.accent }} />
        </span>
        <span className="flex-1 rounded-[5px]" style={{ background: c.card }} />
      </span>
    </span>
  );
}

function ThemePreview({ theme }: { theme: ThemeChoice }) {
  return (
    <span className="flex aspect-[16/9] w-full overflow-hidden">
      {theme === "system" ? (
        <>
          <ThemePane theme="light" />
          <ThemePane theme="dark" />
        </>
      ) : (
        <ThemePane theme={theme} />
      )}
    </span>
  );
}

/** A choice's picture on a plain panel: a size's "Aa", a clock's time, a layout's cards. */
function Plate({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex w-full items-center justify-center bg-surface-raised text-ink",
        wide ? "aspect-[3/1]" : "aspect-[16/9]",
      )}
    >
      {children}
    </span>
  );
}

const SIZE_PX: Record<Size, number> = { small: 15, default: 19, large: 24, larger: 30 };

function LayoutPreview({ density }: { density: Density }) {
  const gap = density === "compact" ? 2 : 5;
  return (
    <span className="flex w-[62%] flex-col" style={{ gap }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rounded-[5px] bg-line"
          style={{ height: density === "compact" ? 7 : 9, opacity: 1 - i * 0.2 }}
        />
      ))}
    </span>
  );
}

/** How the dashboard looks in this browser: its theme, size, layout and clock, each chosen from pictures of it. */
function Appearance() {
  const [theme, setTheme] = useThemeChoice();
  const [display, setDisplay] = useDisplay();
  return (
    <SettingsSection
      id="h-appearance"
      title="Appearance"
      sub="Saved in this browser, so a phone and a wall-mounted tablet can each be set their own way."
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
        <Choice title="Theme" help="System matches your device's light or dark setting.">
          <ChoiceTiles
            label="Theme"
            min="8rem"
            phone={3}
            value={theme}
            onChange={setTheme}
            options={THEME_OPTIONS.map((o) => ({
              value: o.value,
              title: o.label,
              preview: <ThemePreview theme={o.value} />,
            }))}
          />
        </Choice>
        <Choice title="Text size" help="Text, spacing and charts together. Larger is easier to read.">
          <ChoiceTiles
            label="Text size"
            min="6rem"
            phone={2}
            value={display.size}
            onChange={(size) => setDisplay({ size })}
            options={SIZE_OPTIONS.map((o) => ({
              value: o.value,
              title: o.label,
              preview: (
                <Plate>
                  <span className="font-display font-medium" style={{ fontSize: SIZE_PX[o.value] }}>
                    Aa
                  </span>
                </Plate>
              ),
            }))}
          />
        </Choice>
        <Choice title="Layout" help="Compact tightens the space in and between cards, for less scrolling.">
          <ChoiceTiles
            label="Layout"
            min="8rem"
            value={display.density}
            onChange={(density) => setDisplay({ density })}
            options={DENSITY_OPTIONS.map((o) => ({
              value: o.value,
              title: o.label,
              preview: (
                <Plate wide>
                  <LayoutPreview density={o.value} />
                </Plate>
              ),
            }))}
          />
        </Choice>
        <Choice title="Clock" help="How every time on the dashboard is shown.">
          <ChoiceTiles
            label="Clock"
            min="8rem"
            value={display.clock}
            onChange={(clock: Clock) => setDisplay({ clock })}
            options={CLOCK_OPTIONS.map((o) => ({
              value: o.value,
              title: o.label,
              preview: (
                <Plate wide>
                  <span className="text-[26px] font-light tracking-[-0.5px] tabular-nums">
                    {o.value === "12" ? "2:05 pm" : "14:05"}
                  </span>
                </Plate>
              ),
            }))}
          />
        </Choice>
      </div>
    </SettingsSection>
  );
}

/** One of Appearance's choices: its name and a line of help over its tiles. */
function Choice({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-pretty text-ink-muted">{help}</span>
      </div>
      {children}
    </div>
  );
}

/** Stronger contrast, and less motion. */
function Accessibility() {
  const [display, setDisplay] = useDisplay();
  return (
    <SettingsSection id="h-accessibility" title="Accessibility" sub="Also saved in this browser.">
      <OptionList>
        <OptionRow
          id="c-contrast"
          label="More contrast"
          help="Makes secondary text and dividing lines stronger."
          icon="layout"
          color={COLOR.lilac}
        >
          <Switch
            on={display.contrast === "more"}
            onChange={(on) => setDisplay({ contrast: on ? "more" : "default" })}
            aria-labelledby="c-contrast"
          />
        </OptionRow>
        <OptionRow
          id="c-motion"
          label="Reduce motion"
          help="Stops the page animations and moving charts. It's always on when your device asks for less motion."
          icon="pause"
          color={COLOR.lilac}
        >
          <Switch
            on={display.motion === "reduce"}
            onChange={(on) => setDisplay({ motion: on ? "reduce" : "system" })}
            aria-labelledby="c-motion"
          />
        </OptionRow>
      </OptionList>
    </SettingsSection>
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
    <SettingsSection id="h-pw" title="Change password" sub="Changing it signs out every other browser.">
      <form onSubmit={submit} className="flex flex-col gap-6">
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
        <SaveBar label="Change password" pending={change.isPending} error={error} />
      </form>
    </SettingsSection>
  );
}
