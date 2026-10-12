/** An inverter as the user knows it, e.g. "Sungrow SH5.0RS", from what it reported about itself. */
export function inverterName(device: { brand?: string | null; model?: string | null } | null | undefined): string {
  return [device?.brand, device?.model].filter(Boolean).join(" ");
}

/** The second inverter beside the main one, named briefly: its model alone when it's the same make ("SG5K-D"), with
 * its brand when it's another ("Growatt 5000MTL-S"). */
export function secondName(
  main: { brand?: string | null } | null | undefined,
  pv2: { brand?: string | null; model?: string | null } | null | undefined,
): string {
  return pv2?.brand && pv2.brand !== main?.brand ? inverterName(pv2) : (pv2?.model ?? "");
}
