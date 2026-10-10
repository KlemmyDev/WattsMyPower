import type { ErrorComponentProps } from "@tanstack/react-router";
import { useMatch, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, errorMessage, isUnreachable } from "~/features/common/api/utils";
import { copyText, errorReport } from "~/features/common/errors/utils";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import type { IconName } from "~/features/common/ui/components/Icon";

// While the server can't be reached, how often to try again by itself.
const RETRY_MS = 10_000;

/**
 * Whether this is drawn inside the dashboard's frame (side nav, header): a page within it, or the frame's own outlet
 * (an address with no page). Not when the frame itself failed, e.g. it couldn't check the session.
 */
function useInShell(): boolean {
  return useMatch({
    strict: false,
    select: (m) => {
      const id: string = m.routeId ?? "";
      return id === "/_app" ? m.status === "success" : id.startsWith("/_app/");
    },
  });
}

/** A problem in place of a page: a card in the dashboard's frame, or on its own, centred, when there's no frame. */
function Problem({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  const inShell = useInShell();
  const card = (
    <EmptyState icon={icon} title={title} id="h-problem" action={action}>
      {children}
    </EmptyState>
  );
  // From tablets up, below the live clock and the account in the page's top right corner, where a page's title would be.
  if (inShell) return <div className="md:pt-16">{card}</div>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 *:w-full *:max-w-[640px]">
      {card}
    </main>
  );
}

/**
 * Shown in place of a page that failed: while loading (the server couldn't be reached, or answered with an error), or
 * while drawing it. Signed in, it's in the dashboard's frame, so the rest of the dashboard is still there.
 */
export function RouteError({ error, reset, info }: ErrorComponentProps) {
  const router = useRouter();
  const inShell = useInShell();
  const unreachable = isUnreachable(error);
  const retry = () => {
    reset();
    void router.invalidate();
  };
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });
  // Most likely restarting (after an update, say): try again now and then, so the page comes back by itself.
  useEffect(() => {
    if (!unreachable) return;
    const id = setInterval(() => retryRef.current(), RETRY_MS);
    return () => clearInterval(id);
  }, [unreachable]);

  const report = () => errorReport(error, router.options.context.queryClient, info?.componentStack);
  const actions = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button onClick={retry}>Try again</Button>
      {inShell && !unreachable && (
        <ButtonLink to="/" variant="outline">
          Go to Overview
        </ButtonLink>
      )}
      <CopyDetails report={report} />
    </div>
  );

  if (unreachable)
    return (
      <Problem icon="plug" title="Can't reach WattsMyPower's server" action={actions}>
        It might be restarting after an update, or the computer it runs on might be off or offline. This page tries
        again every {RETRY_MS / 1000} seconds.
      </Problem>
    );
  // A request the server answered with an error says what went wrong in its own words.
  const said = error instanceof ApiError ? errorMessage(error) : null;
  return (
    <Problem icon="pulse" title="Something went wrong" action={actions}>
      {said ?? "This page ran into a problem and couldn't be shown."}{" "}
      {inShell ? "Try again, or go back to Overview." : "Try again in a moment."} If it keeps happening, copy the
      details into a bug report.
    </Problem>
  );
}

/** Copies a report of the error; if the browser won't allow that, shows it to copy by hand. */
function CopyDetails({ report }: { report: () => string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const copy = async () => {
    const t = report();
    setText(t);
    setCopied(await copyText(t));
  };
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 2400);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <>
      <Button variant="outline" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy details"}
      </Button>
      {copied === false && (
        <textarea
          readOnly
          aria-label="Details to copy"
          value={text}
          rows={8}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full basis-full rounded-xl border border-line bg-canvas p-3 font-mono text-xs text-ink-muted"
        />
      )}
    </>
  );
}

/** An address with no page: in the dashboard's frame when signed in, with the way back to Overview. */
export function NotFound() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Problem
      icon="pin"
      title="Page not found"
      action={
        <ButtonLink to="/" variant="primary">
          Go to Overview
        </ButtonLink>
      }
    >
      There's no page at <span className="font-mono text-[14px] break-all text-ink">{path}</span>. It may have moved in
      an update, or the link may be mistyped.
    </Problem>
  );
}
