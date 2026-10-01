import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

/** Show a short confirmation at the bottom of the screen: const toast = useToast(); toast("Saved."). */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2400);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        hidden={!message}
        className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-ink-inverse shadow-pop"
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}
