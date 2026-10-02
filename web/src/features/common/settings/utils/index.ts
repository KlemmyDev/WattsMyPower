import { ApiError, errorMessage } from "~/features/common/api/utils";

/**
 * Message for a failed request: the server's own explanation, or `fallback` when it gave none.
 * A request that never reached the server says so instead.
 */
export const failure = (err: unknown, fallback: string) =>
  err instanceof ApiError ? errorMessage(err, fallback) : errorMessage(err);

const FIELD_NAMES: Record<string, string> = {
  latitude: "Latitude",
  longitude: "Longitude",
  bill_months: "Billing frequency",
  bill_day: "Day the period starts",
  bill_anchor: "Month a period starts",
};

/** The settings endpoint's range errors ("latitude must be between -90 and 90") as a sentence. */
export function friendly(detail: string | null): string {
  const m = /^(\w+) must be between (.+) and (.+)$/.exec(detail || "");
  return m ? `${FIELD_NAMES[m[1]] || m[1]} must be between ${m[2]} and ${m[3]}.` : "Invalid value.";
}

/** Why saving settings failed: the range error as a sentence, or that the server couldn't be reached. */
export const saveSettingsError = (err: unknown) => (err instanceof ApiError ? friendly(err.detail) : errorMessage(err));
