/** Thin fetch wrapper for the FastAPI backend. Errors carry the server's readable `detail`. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(detail || statusMessage(status));
    this.name = "ApiError";
  }
}

/** A request that never got an answer: the server is down or restarting, or the network is. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(UNREACHABLE, { cause });
    this.name = "NetworkError";
  }
}

const UNREACHABLE = "Couldn't reach WattsMyPower's server. Check it's running, then try again.";
const GATEWAY = [502, 503, 504];

/** What a status means when the server didn't say: a 502, 503 or 504 is a proxy in front of it that couldn't reach it. */
function statusMessage(status: number): string {
  if (GATEWAY.includes(status))
    return `Couldn't reach WattsMyPower's server (${status}). Check it's running, then try again.`;
  if (status >= 500) return `Something went wrong on the server (${status}). Try again in a moment.`;
  return `The server turned the request down (${status}).`;
}

/** The server didn't answer, or a proxy in front of it said it couldn't reach it. */
export function isUnreachable(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof ApiError && !err.detail && GATEWAY.includes(err.status));
}

/**
 * Message for a failed request, suitable for showing to the user: the server's own explanation, else what its status
 * means (or `fallback`, for a refusal it didn't explain), else that the server couldn't be reached.
 */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) return err.detail || (err.status < 500 && fallback) || statusMessage(err.status);
  if (err instanceof NetworkError) return UNREACHABLE;
  return fallback || UNREACHABLE;
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function apiUrl(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== "") qs.set(k, String(v));
  const q = qs.toString();
  return `/api/${path}${q ? `?${q}` : ""}`;
}

/** The server's `detail`: a sentence, or (from a server that didn't yet put its 422s in words) what was wrong with each field. */
function readDetail(body: unknown): string | null {
  const detail = body && typeof body === "object" && "detail" in body ? body.detail : null;
  if (typeof detail === "string") return detail || null;
  if (!Array.isArray(detail) || !detail.length) return null;
  const parts = detail.map((e: { loc?: unknown[]; msg?: unknown }) => {
    const loc = (e.loc ?? []).map(String);
    const field = (loc.length > 1 && ["body", "query", "path"].includes(loc[0]) ? loc.slice(1) : loc).join(".");
    const msg = String(e.msg ?? "isn't valid").replace(/^Value error, /, "");
    return field ? `${field}: ${msg}` : msg;
  });
  return `${parts.join("; ")}.`;
}

/** fetch, with a request that got no answer thrown as a NetworkError (and one that was called off as it was). */
async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new NetworkError(err);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = readDetail(body);
    if (res.status === 401) window.dispatchEvent(new CustomEvent("wmp:unauthorized"));
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export async function apiGet<T>(path: string, params?: Params, init?: RequestInit): Promise<T> {
  return parse<T>(await send(apiUrl(path, params), { credentials: "same-origin", ...init }));
}

/**
 * POST a file as the raw request body, with its name as the `filename` query parameter (the server has no
 * multipart form parser).
 */
export async function apiUpload<T>(path: string, file: File, params?: Params): Promise<T> {
  return parse<T>(
    await send(apiUrl(path, { ...params, filename: file.name }), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }),
  );
}

export async function apiSend<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return parse<T>(
    await send(apiUrl(path), {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
