import type { HookEventName } from '../../types/hook-types.js';
import { OWFLOW_MUTATION_VERSION, type MutableHookEvent, type OwflowMutationEnvelope } from '../../types/hook-mutation-types.js';

export class MutationProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationProtocolError';
  }
}

export type ParsedMutation = { readonly kind: 'none' } | { readonly kind: 'mutation'; readonly envelope: OwflowMutationEnvelope };

const MUTABLE_EVENT_NAMES = new Set<string>([
  'chat.message',
  'chat.params',
  'chat.headers',
  'command.execute.before',
  'tool.definition',
  'tool.execute.before',
  'tool.execute.after',
  'shell.env',
]);

export const isMutableHookEvent = (event: HookEventName): event is MutableHookEvent => MUTABLE_EVENT_NAMES.has(event);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(detail: string): never {
  throw new MutationProtocolError(detail);
}

const assertPlainObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!isPlainObject(value)) fail(`"${label}" must be a plain object`);
  return value;
};

const assertString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') fail(`"${label}" must be a string`);
  return value;
};

const assertStringRecord = (value: unknown, label: string): Record<string, string> => {
  const record = assertPlainObject(value, label);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string') fail(`"${label}.${key}" must be a string`);
  }
  return record as Record<string, string>;
};

const assertAllowedKeys = (record: Record<string, unknown>, spec: { allowed: readonly string[]; label: string }): void => {
  for (const key of Object.keys(record)) {
    if (!spec.allowed.includes(key)) fail(`unsupported field "${key}" in ${spec.label}`);
  }
};

const ensureObject = (value: unknown): Record<string, unknown> => (isPlainObject(value) ? value : {});

const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const replaceArrayContents = (target: unknown[], replacement: unknown[]): void => {
  target.splice(0, target.length, ...replacement);
};

const appendNoticePart = (output: Record<string, unknown>, notice: string): void => {
  const parts = ensureArray(output.parts);
  parts.push({ type: 'text', text: notice });
  output.parts = parts;
};

const parseProtocolCandidate = (rawStdout: string): Record<string, unknown> | undefined => {
  const trimmed = rawStdout.trim();
  if (!trimmed.startsWith('{')) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  return isPlainObject(parsed) && '$owflow' in parsed ? parsed : undefined;
};

const validateEnvelope = (parsed: Record<string, unknown>): OwflowMutationEnvelope => {
  if (parsed.$owflow !== OWFLOW_MUTATION_VERSION) {
    fail(`unsupported $owflow version ${String(parsed.$owflow)} (expected ${OWFLOW_MUTATION_VERSION})`);
  }

  assertAllowedKeys(parsed, { allowed: ['$owflow', 'mutate', 'hint', 'reason'], label: 'mutation envelope' });
  const mutate = assertPlainObject(parsed.mutate, 'mutate');

  if (typeof parsed.hint !== 'string' || parsed.hint.trim().length === 0) {
    fail('"hint" must be a non-empty string');
  }
  if (parsed.reason !== undefined && typeof parsed.reason !== 'string') {
    fail('"reason" must be a string');
  }

  const envelope: OwflowMutationEnvelope = { $owflow: OWFLOW_MUTATION_VERSION, mutate, hint: parsed.hint };
  if (parsed.reason !== undefined) envelope.reason = parsed.reason;
  return envelope;
};

export const parseMutationEnvelope = (rawStdout: string): ParsedMutation => {
  const parsed = parseProtocolCandidate(rawStdout);
  return parsed === undefined ? { kind: 'none' } : { kind: 'mutation', envelope: validateEnvelope(parsed) };
};

export const buildMutationNotice = (hookName: string, hint: string): string => `[${hookName}]: Hint: ${hint.trim()}`;

interface ApplyInput {
  output: Record<string, unknown>;
  patch: Record<string, unknown>;
  notice?: string;
}

const validateChatMessageFields = (message: Record<string, unknown>): void => {
  assertAllowedKeys(message, { allowed: ['agent', 'model', 'system', 'tools'], label: 'message' });
  if (message.agent !== undefined) assertString(message.agent, 'message.agent');
  if (message.system !== undefined) assertString(message.system, 'message.system');
  if (message.model !== undefined) {
    const model = assertPlainObject(message.model, 'message.model');
    assertAllowedKeys(model, { allowed: ['providerID', 'modelID'], label: 'message.model' });
    assertString(model.providerID, 'message.model.providerID');
    assertString(model.modelID, 'message.model.modelID');
  }
  if (message.tools === undefined) return;
  const tools = assertPlainObject(message.tools, 'message.tools');
  for (const [key, enabled] of Object.entries(tools)) {
    if (typeof enabled !== 'boolean') fail(`"message.tools.${key}" must be a boolean`);
  }
};

const applyChatMessage = ({ output, patch, notice }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['message', 'parts'], label: 'chat.message mutation' });

  if (patch.message !== undefined) {
    const message = assertPlainObject(patch.message, 'message');
    validateChatMessageFields(message);
    const target = ensureObject(output.message);
    Object.assign(target, message);
    output.message = target;
  }

  if (patch.parts !== undefined) {
    if (!Array.isArray(patch.parts)) fail('"parts" must be an array');
    const parts = ensureArray(output.parts);
    replaceArrayContents(parts, patch.parts);
    output.parts = parts;
  }

  if (notice !== undefined) appendNoticePart(output, notice);
};

const applyChatParameters = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'options'], label: 'chat.params mutation' });

  for (const field of ['temperature', 'topP', 'topK', 'maxOutputTokens'] as const) {
    if (patch[field] === undefined) continue;
    if (patch[field] === null) {
      delete output[field];
      continue;
    }
    if (typeof patch[field] !== 'number') fail(`"${field}" must be a number or null`);
    output[field] = patch[field];
  }

  if (patch.options === undefined) return;
  const options = assertPlainObject(patch.options, 'options');
  const target = ensureObject(output.options);
  Object.assign(target, options);
  output.options = target;
};

const applyChatHeaders = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['headers'], label: 'chat.headers mutation' });
  if (patch.headers === undefined) return;
  const headers = assertStringRecord(patch.headers, 'headers');
  const target = ensureObject(output.headers);
  Object.assign(target, headers);
  output.headers = target;
};

const applyCommandExecuteBefore = ({ output, patch, notice }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['parts'], label: 'command.execute.before mutation' });
  if (patch.parts !== undefined) {
    if (!Array.isArray(patch.parts)) fail('"parts" must be an array');
    const parts = ensureArray(output.parts);
    replaceArrayContents(parts, patch.parts);
    output.parts = parts;
  }
  if (notice !== undefined) appendNoticePart(output, notice);
};

const applyToolDefinition = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['description', 'parameters'], label: 'tool.definition mutation' });
  if (patch.description !== undefined) {
    output.description = assertString(patch.description, 'description');
  }
  if (patch.parameters !== undefined) {
    output.parameters = assertPlainObject(patch.parameters, 'parameters');
  }
};

const applyToolExecuteBefore = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['args'], label: 'tool.execute.before mutation' });
  if (patch.args === undefined) return;
  const arguments_ = assertPlainObject(patch.args, 'args');
  const target = ensureObject(output.args);
  Object.assign(target, arguments_);
  output.args = target;
};

const applyToolExecuteAfter = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['title', 'output', 'metadata'], label: 'tool.execute.after mutation' });
  if (patch.title !== undefined) {
    output.title = assertString(patch.title, 'title');
  }
  if (patch.output !== undefined) {
    output.output = assertString(patch.output, 'output');
  }
  if (patch.metadata === undefined) return;
  const metadata = assertPlainObject(patch.metadata, 'metadata');
  const target = ensureObject(output.metadata);
  Object.assign(target, metadata);
  output.metadata = target;
};

const applyShellEnvironment = ({ output, patch }: ApplyInput): void => {
  assertAllowedKeys(patch, { allowed: ['env'], label: 'shell.env mutation' });
  if (patch.env === undefined) return;
  const environment = assertStringRecord(patch.env, 'env');
  const target = ensureObject(output.env);
  Object.assign(target, environment);
  output.env = target;
};

const APPLIERS: Record<MutableHookEvent, (input: ApplyInput) => void> = {
  'chat.message': applyChatMessage,
  'chat.params': applyChatParameters,
  'chat.headers': applyChatHeaders,
  'command.execute.before': applyCommandExecuteBefore,
  'tool.definition': applyToolDefinition,
  'tool.execute.before': applyToolExecuteBefore,
  'tool.execute.after': applyToolExecuteAfter,
  'shell.env': applyShellEnvironment,
};

export const applyHookMutation = (
  event: HookEventName,
  output: Record<string, unknown> | undefined,
  patch: unknown,
  notice?: string,
): void => {
  if (!isMutableHookEvent(event)) {
    fail(`event "${event}" does not support mutations`);
  }
  if (!output || typeof output !== 'object') {
    fail('mutation target output is missing');
  }
  APPLIERS[event]({ output, patch: assertPlainObject(patch, 'mutate'), notice });
};
