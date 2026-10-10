import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { HelpText } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { updateInverter } from "~/features/integrations/api";
import type { ConnectedInverter } from "~/features/integrations/types";

const METER = [
  { value: "behind", label: "House side of the meter" },
  { value: "outside", label: "Outside the meter" },
] as const;

/** Where a second inverter is wired: on the house side of the main inverter's meter, or outside it. */
export function InverterWiring({
  device,
  readOnly,
  bare,
}: {
  device: ConnectedInverter;
  /** Following another server's collector: shown, not changed. */
  readOnly: boolean;
  /** Without its own label: it's in a section that names it. */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const meter = useMutation({
    mutationFn: (behind: boolean) => updateInverter(device.role, { behind_meter: behind }),
    onSuccess: () => {
      toast("Saved. It applies to new readings.");
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
  const behind = meter.isPending ? meter.variables : device.behind_meter !== false;

  return (
    <div className="flex flex-col gap-1.5">
      {!bare && <span className="text-[13px] font-semibold">Where it's wired</span>}
      {readOnly ? (
        <span className="text-sm font-medium">{METER[behind ? 0 : 1].label}</span>
      ) : (
        <Segmented
          label="Where the second inverter is wired"
          options={[...METER]}
          value={behind ? "behind" : "outside"}
          onChange={(v) => meter.mutate(v === "behind")}
          className="w-fit max-sm:w-full"
          // On a phone both labels don't fit on one line: they share the width and wrap.
          buttonClassName="max-sm:min-w-0 max-sm:flex-1 max-sm:justify-center max-sm:px-3 max-sm:text-center max-sm:leading-[18px] max-sm:whitespace-normal"
        />
      )}
      <HelpText>
        {behind
          ? "The usual setup: the main inverter's meter sees its surplus as export, so its output is added to home use."
          : "The main inverter's meter never sees it, so all of its output counts as exported."}
      </HelpText>
      {meter.isError && <HelpText tone="bad">{errorMessage(meter.error)}</HelpText>}
    </div>
  );
}
