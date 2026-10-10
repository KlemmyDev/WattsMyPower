import { useMutation } from "@tanstack/react-query";
import { useResetSession } from "~/features/auth/hooks/useResetSession";
import type { NewAccount } from "~/features/auth/types";
import { apiSend } from "~/features/common/api/utils";

/** Create the household account (first run only, with the set-up code) and sign in. */
export function useCreateAccount() {
  const reset = useResetSession();
  return useMutation({ mutationFn: (c: NewAccount) => apiSend("POST", "auth/setup", c), onSuccess: reset });
}
