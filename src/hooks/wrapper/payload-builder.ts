import type { EventName } from "../../types/hook-types.js";

const IDENTITY_KEYS: readonly string[] = ['id', 'sessionID', 'messageID', 'partID', 'callID', 'providerID', 'type', 'name', 'tool'];

export interface StdinPayloadOptions {
  readonly event: EventName;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly sessionID?: string;
}

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

const isRecord = (value: unknown): value is Record<string, unknown> => isObject(value) && !Array.isArray(value);

interface SessionScopedValue {
  readonly sessionID?: string;
}

interface HostEventProperties extends SessionScopedValue {
  readonly part?: SessionScopedValue;
  readonly info?: SessionScopedValue;
}

interface HostEventEnvelope {
  readonly type?: string;
  readonly properties?: HostEventProperties;
}

const stringFrom = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const sessionScopedFrom = (value: unknown): SessionScopedValue | undefined =>
  isRecord(value) ? { sessionID: stringFrom(value.sessionID) } : undefined;

const hostEventPropertiesFrom = (value: unknown): HostEventProperties | undefined =>
  isRecord(value)
    ? {
        sessionID: stringFrom(value.sessionID),
        part: sessionScopedFrom(value.part),
        info: sessionScopedFrom(value.info),
      }
    : undefined;

const hostEventEnvelopeFrom = (value: unknown): HostEventEnvelope | undefined =>
  isRecord(value)
    ? {
        type: stringFrom(value.type),
        properties: hostEventPropertiesFrom(value.properties),
      }
    : undefined;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const pickIdentityKeys = (value: object): Record<string, unknown> =>
  Object.fromEntries(
    IDENTITY_KEYS.flatMap((key) => {
      const identityValue = Reflect.get(value, key);
      return identityValue === undefined ? [] : [[key, identityValue] as const];
    }),
  );

const serializeValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (!isObject(value)) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value;
  return isPlainObject(value) ? value : pickIdentityKeys(value);
};

const firstString = (candidates: readonly unknown[]): string | undefined =>
  candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);

export const sessionIDFrom = (input: unknown): string | undefined => {
  if (!isRecord(input)) return undefined;
  const properties = hostEventEnvelopeFrom(input.event)?.properties;
  return firstString([stringFrom(input.sessionID), properties?.sessionID, properties?.part?.sessionID, properties?.info?.sessionID]);
};

export const eventTypeFrom = (input: unknown): string | undefined => (isRecord(input) ? hostEventEnvelopeFrom(input.event)?.type : undefined);

const mergeContext = (options: StdinPayloadOptions): Record<string, unknown> => {
  const context: Record<string, unknown> = {};
  for (const source of [options.input, options.output]) {
    if (isRecord(source)) {
      Object.assign(context, source);
    }
  }
  return context;
};

export const buildStdinPayload = (options: StdinPayloadOptions): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    {
      event: options.event,
      ...(options.sessionID && { session: { sessionID: options.sessionID } }),
      context: mergeContext(options),
    },
    (_key, value) => serializeValue(value, seen),
  );
};
