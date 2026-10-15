import { DISPATCHABLE_EVENTS } from "./derivation.js";
import type {
  DispatchableEvent,
  EnvelopeContext,
  EnvelopeResult,
} from "./types.js";

/** The single wire version spoken by every script type and both runners (R4.1). */
export const PROTOCOL_VERSION: EnvelopeContext["protocol"] = "owflow-hooks/1";

export interface EnvelopeBuildInput {
  readonly event: DispatchableEvent;
  readonly context: Record<string, unknown>;
  readonly session?: { readonly sessionID?: string | undefined } | undefined;
}

export interface ParsedEnvelopeResult {
  ok: boolean;
  data?: EnvelopeResult;
  error?: string;
}

/**
 * Identity fields kept when a context value is a host-runtime class instance
 * (`model`/`provider`/`parts`); everything else on such objects is omitted so
 * no instance is ever serialized raw (R4.3).
 */
const CONTEXT_IDENTITY_KEYS: readonly string[] = Object.freeze([
  "id",
  "sessionID",
  "messageID",
  "partID",
  "callID",
  "providerID",
  "type",
  "name",
  "tool",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const projectValue = (value: unknown): unknown => {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => projectValue(item))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const projected: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const projectedItem = projectValue(item);
      if (projectedItem !== undefined) projected[key] = projectedItem;
    }
    return projected;
  }
  return projectIdentity(value);
};

/** Class instances keep only their plain-data identity fields, or vanish. */
const projectIdentity = (value: unknown): unknown => {
  const source = value as Record<string, unknown>;
  const identity: Record<string, unknown> = {};
  for (const key of CONTEXT_IDENTITY_KEYS) {
    const projected = projectValue(source[key]);
    if (projected !== undefined) identity[key] = projected;
  }
  return Object.keys(identity).length > 0 ? identity : undefined;
};

/**
 * Builds the wrapper → script envelope. The class is derived from the shared
 * event table so envelope and registry can never disagree (R6.1); the context
 * is projected to plain JSON data (R4.3).
 */
export const buildEnvelope = (input: EnvelopeBuildInput): EnvelopeContext => {
  const sessionID = input.session?.sessionID;
  const projected = projectValue(input.context);
  return {
    protocol: PROTOCOL_VERSION,
    event: input.event,
    class: DISPATCHABLE_EVENTS[input.event],
    ...(typeof sessionID === "string" && sessionID.length > 0
      ? { session: { sessionID } }
      : {}),
    context:
      typeof projected === "object" &&
      projected !== null &&
      !Array.isArray(projected)
        ? (projected as Record<string, unknown>)
        : {},
  };
};

const describeType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateResultObject = (
  record: Record<string, unknown>,
): ParsedEnvelopeResult => {
  const protocol = record.protocol;
  if (protocol === undefined) {
    return {
      ok: false,
      error: `missing protocol (expected "${PROTOCOL_VERSION}")`,
    };
  }
  if (protocol !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `protocol mismatch (expected "${PROTOCOL_VERSION}", got ${JSON.stringify(protocol)})`,
    };
  }
  const status = record.status;
  if (status !== "ok" && status !== "blocked" && status !== "failed") {
    return {
      ok: false,
      error: `invalid status ${JSON.stringify(status)} (expected "ok", "blocked", or "failed")`,
    };
  }
  const reason = record.reason;
  if (reason !== undefined && typeof reason !== "string") {
    return { ok: false, error: "invalid reason (expected a string)" };
  }
  const mutations = record.mutations;
  if (mutations !== undefined && !isJsonObject(mutations)) {
    return { ok: false, error: "invalid mutations (expected a JSON object)" };
  }
  return {
    ok: true,
    data: {
      protocol: PROTOCOL_VERSION,
      status,
      ...(reason !== undefined ? { reason } : {}),
      ...(mutations !== undefined ? { mutations } : {}),
    },
  };
};

/**
 * Parses a script result from either class: stdout JSON for subprocesses or a
 * returned object for in-process handlers. Never throws and never logs — every
 * malformed or mismatched result becomes a sentinel (R4.2).
 */
export const parseEnvelopeResult = (raw: unknown): ParsedEnvelopeResult => {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `unparseable JSON (${errorText(error)})`,
      };
    }
  }
  if (!isJsonObject(value)) {
    return {
      ok: false,
      error: `result is not a JSON object (got ${describeType(value)})`,
    };
  }
  try {
    return validateResultObject(value);
  } catch (error) {
    return { ok: false, error: `unreadable result (${errorText(error)})` };
  }
};
