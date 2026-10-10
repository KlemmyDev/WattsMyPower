import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { sessionQuery } from "~/features/auth/api";
import {
  CODE_LENGTH,
  CodeInput,
  CopyButton,
  MatchHint,
  PasswordInput,
  StrengthMeter,
} from "~/features/auth/components/AuthFields";
import { AuthScene } from "~/features/auth/components/AuthScene";
import { useCreateAccount } from "~/features/auth/hooks/useCreateAccount";
import { useLogin } from "~/features/auth/hooks/useLogin";
import { ApiError, errorMessage } from "~/features/common/api/utils";
import { BrandLockup, StandalonePage } from "~/features/common/layout/components/Standalone";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Field, Input } from "~/features/common/ui/components/Field";
import { BrandMark, Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Spinner } from "~/features/common/ui/components/Progress";
import { cn } from "~/features/common/ui/utils";

/** The shortest password the server takes. */
const MIN_PASSWORD = 8;

/** What the dashboard does, beside the picture on a wide screen. */
const FEATURES: { icon: IconName; color: string; label: string }[] = [
  { icon: "sun", color: COLOR.solar, label: "Live power flow" },
  { icon: "cloudSun", color: COLOR.brand, label: "Solar forecast" },
  { icon: "battery", color: COLOR.battery, label: "Battery planning" },
  { icon: "dollar", color: COLOR.good, label: "Bill estimates" },
];

/**
 * Sign in, or on first run create the household account: the house from the Overview beside the form on a wide
 * screen, above it on a phone, over the same soft light as the dashboard's pages. Creating the account takes two
 * steps (the set-up code, then a username and password) and ends on a moment to say it worked before the set-up
 * guide opens.
 */
export function LoginPage({ redirectTo }: { redirectTo?: string }) {
  const { data: session } = useQuery(sessionQuery);
  // Held here: once the account exists the session no longer asks for one, but the card should still say it worked.
  const [created, setCreated] = useState<string | null>(null);
  const setup = !!session?.setup_required;
  return (
    <StandalonePage>
      <div className="mx-auto grid min-h-screen w-full max-w-[1180px] items-center gap-14 px-8 py-10 max-lg:max-w-[520px] max-lg:content-start max-lg:gap-6 max-sm:px-4 max-sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,420px)]">
        <Hero />
        <div className="glass relative animate-rise rounded-3xl border border-line-subtle p-8 shadow-[0_24px_60px_-30px_var(--color-shadow-pop)] [animation-delay:80ms] max-sm:rounded-[22px] max-sm:p-6">
          {created ? (
            <Created username={created} redirectTo={redirectTo} />
          ) : setup ? (
            <CreateAccount onCreated={setCreated} />
          ) : (
            <SignIn redirectTo={redirectTo} />
          )}
        </div>
      </div>
    </StandalonePage>
  );
}

function Hero() {
  return (
    <div className="flex min-w-0 animate-rise flex-col gap-8 max-lg:gap-5">
      <BrandLockup size="lg" />
      <div className="flex flex-col gap-3 max-lg:hidden">
        <p className="m-0 font-display text-[44px] leading-[50px] font-semibold tracking-[-1.2px] text-balance">
          Your solar, battery and bills, <span className="text-solar">live</span>.
        </p>
        <p className="m-0 max-w-[520px] text-base leading-6 text-pretty text-ink-muted">
          Read straight from your inverter every minute, over your own network.
        </p>
      </div>
      <AuthScene />
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0 max-lg:hidden">
        {FEATURES.map((f) => (
          <li
            key={f.label}
            className="flex items-center gap-2 rounded-full border border-line-subtle bg-surface/60 py-1.5 pr-3.5 pl-1.5 text-[13px] text-ink-muted"
          >
            <span
              className="flex size-6 items-center justify-center rounded-full"
              style={{ background: alpha(f.color, 0.16), color: f.color }}
            >
              <Icon name={f.icon} size={14} />
            </span>
            {f.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Hello again" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** The card's heading and a line under it. */
function CardIntro({ eyebrow, title, children }: { eyebrow?: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {eyebrow}
      <h1 id="h-login" className="text-[32px] leading-10 tracking-[-0.8px] max-sm:text-[28px] max-sm:leading-9">
        {title}
      </h1>
      <p className="m-0 text-sm leading-[22px] text-pretty text-ink-muted">{children}</p>
    </div>
  );
}

/** What went wrong, in a soft red panel. Keyed by the caller so a repeat of the same error still draws the eye. */
function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex animate-pop items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-5 text-bad"
      style={{ background: alpha(COLOR.bad, 0.1) }}
    >
      <Icon name="x" size={15} className="mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/** The main button, full width, with a spinner while it works. */
function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="lg" disabled={busy || disabled} className="w-full justify-center">
      {busy ? <Spinner size={16} className="text-current" /> : null}
      {children}
      {!busy && <Icon name="arrowR" size={17} />}
    </Button>
  );
}

/** Shakes the form when `tries` goes up (a wrong password), as a Mac's sign-in does. */
function useShake(tries: number) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!tries || !el) return;
    el.classList.remove("animate-shake");
    void el.offsetWidth; // restart it
    el.classList.add("animate-shake");
  }, [tries]);
  return ref;
}

function SignIn({ redirectTo }: { redirectTo?: string }) {
  const login = useLogin();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const form = useShake(tries);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login.mutateAsync({ username, password });
      navigate({ to: redirectTo || "/", replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setTries((t) => t + 1);
    }
  }

  return (
    <form ref={form} onSubmit={submit} aria-labelledby="h-login" className="flex flex-col gap-7">
      <CardIntro title={greeting()}>Sign in to see your solar, battery and savings.</CardIntro>
      <div className="flex flex-col gap-4">
        <Field label="Username">
          <Input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            invalid={!!error}
            required
          />
        </Field>
        <ErrorNote key={tries}>{error}</ErrorNote>
      </div>
      <SubmitButton busy={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</SubmitButton>
      <Disclosure label="Forgotten your password?">
        <span>
          There's no reset by email: the account lives on your own server. To start again with a new one, run this from
          the install folder:
        </span>
        <Command text={RESET} />
      </Disclosure>
    </form>
  );
}

type Stage = "code" | "account";

/** Which of the two steps, as two short bars over the heading. */
function Steps({ stage }: { stage: Stage }) {
  const n = stage === "code" ? 1 : 2;
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex gap-1.5">
        {[1, 2].map((k) => (
          <span
            key={k}
            className={cn("h-1.5 rounded-full transition-all duration-500 ease-out", k <= n ? "w-7" : "w-3.5")}
            style={{ background: k <= n ? COLOR.solar : COLOR.track }}
          />
        ))}
      </span>
      <span className="text-xs font-medium text-ink-faint">Step {n} of 2</span>
    </div>
  );
}

function CreateAccount({ onCreated }: { onCreated: (username: string) => void }) {
  const create = useCreateAccount();
  const [stage, setStage] = useState<Stage>("code");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [tries, setTries] = useState(0);
  const form = useShake(tries);
  const codeId = useId();
  const whole = code.length === CODE_LENGTH;
  const short = password.length < MIN_PASSWORD;
  const mismatch = !!confirm && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (stage === "code") {
      if (whole) setStage("account");
      return;
    }
    setError("");
    if (short) return setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The passwords don't match.");
    try {
      await create.mutateAsync({ username, password, code: `${code.slice(0, 4)}-${code.slice(4)}` });
      onCreated(username.trim());
    } catch (err) {
      // A wrong code: back to it, emptied, to try again.
      if (err instanceof ApiError && err.status === 403) {
        setCode("");
        setCodeError(errorMessage(err));
        setStage("code");
      } else setError(errorMessage(err));
      setTries((t) => t + 1);
    }
  }

  return (
    <form ref={form} onSubmit={submit} aria-labelledby="h-login" className="flex flex-col gap-7">
      {stage === "code" ? (
        <div key="code" className="flex animate-rise flex-col gap-7">
          <CardIntro eyebrow={<Steps stage={stage} />} title="Welcome aboard">
            Enter the set-up code from when WattsMyPower was installed. It shows this dashboard is yours.
          </CardIntro>
          <div className="flex flex-col gap-3">
            <label htmlFor={codeId} className="text-[13px] font-semibold">
              Set-up code
            </label>
            <CodeInput
              id={codeId}
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError("");
              }}
              invalid={!!codeError}
              autoFocus
            />
            <ErrorNote key={tries}>{codeError}</ErrorNote>
            <WhereIsTheCode />
          </div>
          <SubmitButton busy={false} disabled={!whole}>
            Continue
          </SubmitButton>
        </div>
      ) : (
        <div key="account" className="flex animate-rise flex-col gap-7">
          <CardIntro eyebrow={<Steps stage={stage} />} title="Choose your sign-in">
            Choose a username and password. Anyone on your network will need them to see your data or change settings.
          </CardIntro>
          <div className="flex flex-col gap-4">
            <Field label="Username">
              <Input
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Password</span>
              <PasswordInput
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                required
                minLength={MIN_PASSWORD}
              />
              <StrengthMeter password={password} min={MIN_PASSWORD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Confirm password</span>
              <PasswordInput
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
                invalid={mismatch && !password.startsWith(confirm)}
                required
              />
              <MatchHint password={password} confirm={confirm} />
            </label>
            <ErrorNote key={tries}>{error}</ErrorNote>
          </div>
          <div className="flex flex-col gap-3">
            <SubmitButton busy={create.isPending}>
              {create.isPending ? "Creating your account…" : "Create account"}
            </SubmitButton>
            <Button
              variant="muted-link"
              className="self-center"
              disabled={create.isPending}
              onClick={() => setStage("code")}
            >
              Back to the code
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

const LOGS = "docker compose logs wattsmypower";
const RESET = "docker compose exec wattsmypower python -m app reset-account";

/** A line of help folded away under a link until it's asked for. */
function Disclosure({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-[13px] font-medium text-link hover:text-link-hover"
      >
        {label}
        <Icon
          name="chevD"
          size={14}
          className={cn("transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-3 flex w-full animate-pop flex-col gap-3 rounded-2xl bg-canvas/60 p-4 text-left text-[13px] leading-5 text-pretty text-ink-muted light:bg-canvas">
          {children}
        </div>
      )}
    </div>
  );
}

/** A command to run, in a box with a button to copy it. */
function Command({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 rounded-xl border border-line-subtle bg-surface py-1.5 pr-1.5 pl-3">
      <Icon name="terminal" size={14} className="text-ink-faint" />
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs leading-[18px] break-all text-ink">{text}</code>
      <CopyButton text={text} />
    </span>
  );
}

/** Where the set-up code is, folded away until asked. */
function WhereIsTheCode() {
  return (
    <Disclosure label="Where do I find it?">
      <span>The installer printed it when it finished. It's also in the dashboard's logs:</span>
      <Command text={LOGS} />
      <span>
        Or open <code className="font-mono text-ink">data/setup-code</code> in the install folder. It's only needed this
        once.
      </span>
    </Disclosure>
  );
}

/** The account's made: a moment to say so, then on to the set-up guide (or wherever the sign-in was going). */
function Created({ username, redirectTo }: { username: string; redirectTo?: string }) {
  const navigate = useNavigate();
  const go = useCallback(() => navigate({ to: redirectTo || "/", replace: true }), [navigate, redirectTo]);
  useEffect(() => {
    const t = setTimeout(go, 2400);
    return () => clearTimeout(t);
  }, [go]);
  return (
    <div role="status" className="flex flex-col items-center gap-6 py-6 text-center">
      <span className="relative flex size-20 items-center justify-center">
        <span
          aria-hidden
          className="radar-ripple absolute inset-0 rounded-full"
          style={{ background: alpha(COLOR.solar, 0.25) }}
        />
        <span
          className="relative flex size-20 animate-spring-in items-center justify-center rounded-[26px] border border-fg/8 bg-linear-160 from-mark-from to-mark-to"
          style={{ boxShadow: `0 0 40px ${alpha(COLOR.solar, 0.35)}` }}
        >
          <BrandMark size={32} />
        </span>
      </span>
      <div className="flex animate-rise flex-col gap-2 [animation-delay:200ms]">
        <h1 id="h-login" className="text-[30px] leading-9 tracking-[-0.8px] wrap-anywhere">
          You're in, {username}
        </h1>
        <p className="m-0 text-sm leading-[22px] text-pretty text-ink-muted">
          Next, a few quick steps to connect your inverter and make the dashboard yours.
        </p>
      </div>
      <Button size="lg" className="animate-rise justify-center [animation-delay:320ms]" onClick={go}>
        Let's go
        <Icon name="arrowR" size={17} />
      </Button>
    </div>
  );
}
