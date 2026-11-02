import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { KeysResponse, NewKey } from "~/features/developers/types";

/** The keys made so far, and the permissions a key can be given. */
export const keysQuery = queryOptions({
  queryKey: ["keys"],
  queryFn: ({ signal }) => apiGet<KeysResponse>("keys", undefined, { signal }),
});

/** Make a key. The whole key is in the answer, once. */
export const makeKey = (body: { name: string; scopes: string[] }) => apiSend<NewKey>("POST", "keys", body);

/** Remove a key; it stops working at once. */
export const removeKey = (id: string) => apiSend<{ ok: true }>("DELETE", `keys/${id}`);
