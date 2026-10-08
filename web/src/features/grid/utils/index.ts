import { COLOR } from "~/features/common/theme/utils/colors";
import type { NemRegion, NoticeKind, OutlookLevel } from "~/features/grid/types";

/** Power from the grid, and power sent to it: the colours the power flow gives them. */
export const IMPORT = COLOR.import;
export const EXPORT = COLOR.export;

export const REGIONS: { id: NemRegion; label: string }[] = [
  { id: "QLD1", label: "Queensland" },
  { id: "NSW1", label: "New South Wales & ACT" },
  { id: "VIC1", label: "Victoria" },
  { id: "SA1", label: "South Australia" },
  { id: "TAS1", label: "Tasmania" },
];

/** A wholesale price ($/MWh) in cents a kWh, as the bills have it: $412.50/MWh is 41.3c. */
export const wholesaleCents = (mwh: number | null | undefined) =>
  mwh == null ? "—" : `${mwh < 0 ? "−" : ""}${Math.abs(mwh / 10).toFixed(1)}c`;

/** A wholesale price as AEMO gives it: "$412/MWh", "−$40/MWh". */
export const perMWh = (mwh: number | null | undefined) =>
  mwh == null ? "—" : `${mwh < 0 ? "−" : ""}$${Math.round(Math.abs(mwh)).toLocaleString("en-AU")}/MWh`;

/** Each level of the outlook: a word for it, its colour and its icon. */
export const LEVEL: Record<OutlookLevel, { word: string; color: string; sub: string }> = {
  normal: { word: "Grid normal", color: COLOR.good, sub: "Nothing to worry about on the grid." },
  watch: { word: "Worth knowing", color: COLOR.solar, sub: "Nothing urgent, but keep an eye on it." },
  warning: {
    word: "Blackout risk",
    color: COLOR.warn,
    sub: "Keep your battery charged, and go easy on big appliances.",
  },
  outage: { word: "Grid down", color: COLOR.danger, sub: "Your battery is running the house." },
};

/** What each kind of AEMO notice means, for someone who isn't an energy trader. */
export const NOTICE_HELP: Record<NoticeKind, string> = {
  lor1: "Lack of Reserve 1: spare generation is lower than AEMO likes. Rarely leads to anything.",
  lor2: "Lack of Reserve 2: if one big generator or line failed, there wouldn't be enough to go round.",
  lor3: "Lack of Reserve 3: there isn't enough supply for demand. Rotating blackouts (load shedding) may follow.",
  load_shedding: "AEMO has directed networks to cut supply to some areas to keep the system running.",
  system_event: "Something on the power system tripped or failed unexpectedly.",
  suspension: "AEMO has suspended the market: the system is in serious trouble.",
  price_cap: "Prices were extreme for long enough that AEMO has capped them, or is reviewing them.",
  msl1: "Very little demand on the grid (lots of rooftop solar). AEMO is watching.",
  msl2: "Very little demand on the grid. AEMO may act to keep the system secure.",
  msl3: "So little demand that networks may switch rooftop solar off (backstop) to keep the system secure.",
};
