import { twMerge } from "tailwind-merge";

/** Join class names, skipping falsy values; later Tailwind classes override earlier conflicting ones. */
export const cn = (...parts: (string | false | null | undefined)[]) => twMerge(parts.filter(Boolean).join(" "));
