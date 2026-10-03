/** Thin fetch wrapper for the FastAPI backend. Errors carry the server's readable `detail`. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(detail || `Request failed (${status})`);
    this.name = "ApiError";
  }
}

/** Message for a failed request, suitable for showing to the user. */
export function errorMessage(err: unknown, fallback = "The server could not be reached. Try again."): string {
  if (err instanceof ApiError) return err.detail || fallback;
  return fallback;
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function apiUrl(path: string, params?: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== "") qs.set(k, String(v));
  const q = qs.toString();
  return `/api/${path}${q ? `?${q}` : ""}`;
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : null;
    if (res.status === 401) window.dispatchEvent(new CustomEvent("wmp:unauthorized"));
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export async function apiGet<T>(path: string, params?: Params, init?: RequestInit): Promise<T> {
  return parse<T>(await fetch(apiUrl(path, params), { credentials: "same-origin", ...init }));
}

/**
 * POST a file as the raw request body, with its name as the `filename` query parameter (the server has no
 * multipart form parser).
 */
export async function apiUpload<T>(path: string, file: File, params?: Params): Promise<T> {
  return parse<T>(
    await fetch(apiUrl(path, { ...params, filename: file.name }), {
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
    await fetch(apiUrl(path), {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
