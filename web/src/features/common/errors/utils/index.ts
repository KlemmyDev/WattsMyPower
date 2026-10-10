import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "~/features/common/api/utils";
import { liveQuery } from "~/features/common/live/api";
import { updatesQuery } from "~/features/updates/api";

/** The version the server last said it is: from the live status, or the update check. Null if it hasn't said. */
function appVersion(qc: QueryClient): string | null {
  const app = qc.getQueryData(liveQuery.queryKey)?.app ?? qc.getQueryData(updatesQuery.queryKey)?.current;
  if (!app) return null;
  const release = app.release ? ` ${app.release}` : "";
  return `${app.version}${release}${app.commit ? ` (commit ${app.commit.slice(0, 7)})` : ""}`;
}

/** What went wrong, for a bug report: the version, the page, the browser, and the error with where it happened. */
export function errorReport(error: unknown, qc: QueryClient, componentStack?: string): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const name = err instanceof ApiError ? `${err.name} ${err.status}` : err.name;
  const stack = (err.stack ?? "")
    .split("\n")
    .filter((line) => line.trim().startsWith("at ") || line.includes("@"))
    .slice(0, 8);
  const components = (componentStack ?? "").trim().split("\n").slice(0, 6);
  return [
    `WattsMyPower ${appVersion(qc) ?? "(version unknown: the server hasn't said)"}`,
    `Page: ${window.location.pathname}${window.location.search}`,
    `When: ${new Date().toISOString()}`,
    `Browser: ${navigator.userAgent}`,
    `Error: ${name}: ${err.message}`,
    ...(stack.length ? ["", ...stack.map((l) => l.trim())] : []),
    ...(components.length && components[0] ? ["", "Components:", ...components.map((l) => l.trim())] : []),
  ].join("\n");
}

/**
 * Put text on the clipboard. The Clipboard API needs a secure page (https, or localhost), which a dashboard opened at
 * its address on the home network isn't, so it falls back to copying from a hidden text box. False if neither worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.append(box);
    box.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
}
