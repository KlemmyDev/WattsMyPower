import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend, apiUpload } from "~/features/common/api/utils";
import type { ColumnChoices, ImportPreview, ImportRecord, ImportResult } from "~/features/imports/types";

export const importsQuery = queryOptions({
  queryKey: ["imports"],
  queryFn: ({ signal }) => apiGet<ImportRecord[]>("imports", undefined, { signal }),
});

const columnsParam = (choices: ColumnChoices) => (Object.keys(choices).length ? JSON.stringify(choices) : undefined);

/** What an export holds and what importing it would change. Writes nothing. */
export const previewImport = (file: File, choices: ColumnChoices) =>
  apiUpload<ImportPreview>("imports/preview", file, { name: file.name, columns: columnsParam(choices) });

/** Import an export, as a new import or (`into`) as one more file of an earlier one. */
export const runImport = (file: File, choices: ColumnChoices, into: number | null, label: string) =>
  apiUpload<ImportResult>("imports", file, { name: file.name, columns: columnsParam(choices), into, label });

export const removeImport = (id: number) => apiSend<{ removed: number }>("DELETE", `imports/${id}`);
