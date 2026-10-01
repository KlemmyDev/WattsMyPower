import { useQueryClient } from "@tanstack/react-query";
import { sessionQuery } from "~/features/auth/api";

/** After signing in or out, drop everything cached for the previous session. */
export function useResetSession() {
  const qc = useQueryClient();
  return async () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    await qc.invalidateQueries({ queryKey: sessionQuery.queryKey });
  };
}
