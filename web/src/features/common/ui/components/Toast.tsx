import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/features/common/ui/utils";

const ToastContext = createContext<(message: string) => void>(() => {});

/** Show a short confirmation at the bottom of the screen: const toast = useToast(); toast("Saved."). */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  // The last message stays in place while it slides away, so the pill doesn't empty as it goes.
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2400);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-ink-inverse shadow-pop transition-[opacity,translate,scale] duration-300 ease-out-soft",
          shown ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0",
        )}
      >
        {shown ? message : ""}
        {!shown && <span aria-hidden>{message}</span>}
      </div>
    </ToastContext.Provider>
  );
}
