/** An inverter as the user knows it, e.g. "Sungrow SH5.0RS", from what it reported about itself. */
export function inverterName(device: { brand?: string | null; model?: string | null } | null | undefined): string {
  return [device?.brand, device?.model].filter(Boolean).join(" ");
}
