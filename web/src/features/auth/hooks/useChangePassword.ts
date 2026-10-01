import { useMutation } from "@tanstack/react-query";
import { apiSend } from "~/features/common/api/utils";

/** Change the password; the server signs out every other browser. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (p: { current: string; new: string }) => apiSend("PUT", "auth/password", p),
  });
}
