import { useState, type FormEvent } from "react";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";

/** Enter or change what the system cost. Without a cost saved yet there's nothing to cancel back to. */
export function SystemCostForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: string;
  /** Omitted when no cost has been entered, which hides Cancel. */
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const save = useSaveSettings();
  const toast = useToast();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = Number(value.replace(/[$,\s]/g, ""));
    if (!value.trim() || !Number.isFinite(v) || v <= 0 || v > 1e6) {
      setError("Enter the cost in dollars, for example 18400.");
      return;
    }
    save.mutate(
      { system_cost: Math.round(v) },
      {
        onSuccess: () => {
          setError("");
          toast("System cost saved.");
          onSaved();
        },
        onError: (err) => setError(saveSettingsError(err)),
      },
    );
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-xs:grid-cols-1"
    >
      <Field label="What your solar and battery system cost">
        <Input
          prefix="$"
          inputMode="decimal"
          autoComplete="off"
          placeholder="18,400"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          // Opened with Edit: put the cursor straight in the box.
          autoFocus={!!onCancel}
        />
      </Field>
      <div className="flex gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
      <HelpText tone="bad" className="col-span-full">
        {error}
      </HelpText>
    </form>
  );
}
