import type { HookEventName } from '../../types/hook-types.js';

const IDENTITY_KEYS: readonly string[] = ['id', 'sessionID', 'messageID', 'partID', 'callID', 'providerID', 'type', 'name', 'tool'];

export interface StdinPayloadOptions {
  readonly event: HookEventName;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly sessionID?: string;
}

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

const isRecord = (value: unknown): value is Record<string, unknown> => isObject(value) && !Array.isArray(value);

export const readProperty = (source: unknown, propertyName: string): unknown =>
  isObject(source) ? Reflect.get(source, propertyName) : undefined;

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
  const properties = readProperty(readProperty(input, 'event'), 'properties');
  return firstString([
    readProperty(input, 'sessionID'),
    readProperty(properties, 'sessionID'),
    readProperty(readProperty(properties, 'part'), 'sessionID'),
    readProperty(readProperty(properties, 'info'), 'sessionID'),
  ]);
};

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

export const resolveStdinPayloadOptions = (
  eventOrOptions: HookEventName | StdinPayloadOptions,
  rest: readonly unknown[],
): StdinPayloadOptions => {
  if (typeof eventOrOptions === 'object') return eventOrOptions;
  return {
    event: eventOrOptions,
    input: rest[0],
    output: rest[1],
    ...(typeof rest[2] === 'string' && { sessionID: rest[2] }),
  };
};
