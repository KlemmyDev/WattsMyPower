import { useMutation } from "@tanstack/react-query";
import { useResetSession } from "~/features/auth/hooks/useResetSession";
import type { Credentials } from "~/features/auth/types";
import { apiSend } from "~/features/common/api/utils";

export function useLogin() {
  const reset = useResetSession();
  return useMutation({ mutationFn: (c: Credentials) => apiSend("POST", "auth/login", c), onSuccess: reset });
}
