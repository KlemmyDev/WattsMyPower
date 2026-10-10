import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiGet, apiUrl } from "~/features/common/api/utils";
import type { BackupProgress, BackupSaved, StorageReport } from "~/features/storage/types";

/** Both databases measured. The server reuses a measure for 5 minutes; `measureAgain` asks for a new one. */
export const storageQuery = queryOptions({
  queryKey: ["storage"],
  queryFn: ({ signal }) => apiGet<StorageReport>("storage", undefined, { signal }),
  staleTime: 5 * 60_000,
});

export const measureAgain = () => apiGet<StorageReport>("storage", { fresh: true });

/**
 * Download a backup: the dashboard's database, and with `everything` the collector's too, zipped. The server makes it
 * before sending a byte (a while, for a large collector database), then it comes down with its length, so `progress`
 * hears how far along it is. Once it's all here, the browser saves it under the name the server gave it.
 */
export async function downloadBackup(everything: boolean, progress: (p: BackupProgress) => void): Promise<BackupSaved> {
  progress({ stage: "making" });
  const res = await fetch(apiUrl("storage/backup", { everything }), { credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 401) window.dispatchEvent(new CustomEvent("wmp:unauthorized"));
    throw new ApiError(res.status, body && typeof body.detail === "string" ? body.detail : null);
  }
  const length = Number(res.headers.get("Content-Length"));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  progress({ stage: "downloading", received, total });
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(res.status, "This browser can't download the backup. Try another one.");
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    chunks.push(part.value);
    received += part.value.byteLength;
    progress({ stage: "downloading", received, total });
  }
  if (total != null && received < total) throw new ApiError(res.status, "The download stopped part way. Try again.");

  const name =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "wattsmypower-backup.zip";
  const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start saving after the click returns: let go of the file a little later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const skipped = res.headers.get("X-Backup-Skipped");
  return { name, bytes: received, skipped: skipped ? decodeURIComponent(skipped) : null };
}
