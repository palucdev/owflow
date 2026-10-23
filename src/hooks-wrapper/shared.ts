/**
 * Small shared primitives for the platform-agnostic hooks wrapper. Kept in one
 * module so the dispatcher, runners, registry, and reports cannot drift apart.
 */

export const BLOCKED_PREFIX = "Blocked:";

/** Strict JSON-object guard: arrays and null are not records. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Locale-independent code-unit comparison, shared by every sort site. */
export const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
};
