import { useState, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";

/**
 * A button that asks first (Disconnect, Remove): pressed, it shows what doing it means (`note`) beside a button that
 * does it, and Cancel. `run` is called with a callback for when it's done.
 */
export function ConfirmAction({
  label,
  doing,
  note,
  pending,
  error,
  run,
}: {
  label: string;
  /** What the button says while it's under way ("Disconnecting…"). */
  doing: string;
  note: ReactNode;
  pending: boolean;
  error?: unknown;
  run: (done: () => void) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2 max-sm:items-start">
      {confirming ? (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setConfirming(false))}>
            {pending ? doing : label}
          </Button>
          <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      {(confirming || !!error) && (
        <HelpText tone={error ? "bad" : undefined} className="max-w-[420px] text-right max-sm:text-left">
          {error ? errorMessage(error) : note}
        </HelpText>
      )}
    </div>
  );
}
