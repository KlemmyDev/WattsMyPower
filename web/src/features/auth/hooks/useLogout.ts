import { useMutation } from "@tanstack/react-query";
import { useResetSession } from "~/features/auth/hooks/useResetSession";
import { apiSend } from "~/features/common/api/utils";

export function useLogout() {
  const reset = useResetSession();
  return useMutation({ mutationFn: () => apiSend("POST", "auth/logout"), onSuccess: reset });
}
