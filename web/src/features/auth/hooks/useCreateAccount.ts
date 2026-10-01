import { useMutation } from "@tanstack/react-query";
import { useResetSession } from "~/features/auth/hooks/useResetSession";
import type { Credentials } from "~/features/auth/types";
import { apiSend } from "~/features/common/api/utils";

/** Create the household account (first run only) and sign in. */
export function useCreateAccount() {
  const reset = useResetSession();
  return useMutation({ mutationFn: (c: Credentials) => apiSend("POST", "auth/setup", c), onSuccess: reset });
}
