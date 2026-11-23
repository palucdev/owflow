import { expect, test } from 'bun:test';
import { createDefaultEnvironmentConfig, createTestEnvironmentConfig } from '../../utils/environment-config.js';

const environment = Bun.env as Record<string, string | undefined>;
const TIMEOUT_MS = 2500;
const LOG_FILE = 'owflow-env-config-log.jsonl';

test('createDefaultEnvironmentConfig maps OWFLOW_* variables onto the config', () => {
  const previousDisabled = environment['OWFLOW_HOOKS_DISABLED'];
  const previousTimeout = environment['OWFLOW_HOOK_TIMEOUT_MS'];
  const previousLog = environment['OWFLOW_HOOK_LOGS_FILE'];
  environment['OWFLOW_HOOKS_DISABLED'] = '1';
  environment['OWFLOW_HOOK_TIMEOUT_MS'] = String(TIMEOUT_MS);
  environment['OWFLOW_HOOK_LOGS_FILE'] = LOG_FILE;
  try {
    const config = createDefaultEnvironmentConfig();
    expect(config.isHooksDisabled).toBe(true);
    expect(config.hookTimeoutMs).toBe(TIMEOUT_MS);
    expect(config.logFilePath).toBe(LOG_FILE);
  } finally {
    if (previousDisabled === undefined) delete environment['OWFLOW_HOOKS_DISABLED'];
    else environment['OWFLOW_HOOKS_DISABLED'] = previousDisabled;
    if (previousTimeout === undefined) delete environment['OWFLOW_HOOK_TIMEOUT_MS'];
    else environment['OWFLOW_HOOK_TIMEOUT_MS'] = previousTimeout;
    if (previousLog === undefined) delete environment['OWFLOW_HOOK_LOGS_FILE'];
    else environment['OWFLOW_HOOK_LOGS_FILE'] = previousLog;
  }
});

test('createDefaultEnvironmentConfig prefers USER over USERNAME for the username', () => {
  const previousUser = environment['USER'];
  const previousUsername = environment['USERNAME'];
  environment['USER'] = 'env-config-user';
  delete environment['USERNAME'];
  try {
    expect(createDefaultEnvironmentConfig().username).toBe('env-config-user');
  } finally {
    if (previousUser === undefined) delete environment['USER'];
    else environment['USER'] = previousUser;
    if (previousUsername === undefined) delete environment['USERNAME'];
    else environment['USERNAME'] = previousUsername;
  }
});

test('createDefaultEnvironmentConfig yields no timeout when the raw value is not a finite number', () => {
  const previousTimeout = environment['OWFLOW_HOOK_TIMEOUT_MS'];
  environment['OWFLOW_HOOK_TIMEOUT_MS'] = 'not-a-number';
  try {
    expect(createDefaultEnvironmentConfig().hookTimeoutMs).toBeUndefined();
  } finally {
    if (previousTimeout === undefined) delete environment['OWFLOW_HOOK_TIMEOUT_MS'];
    else environment['OWFLOW_HOOK_TIMEOUT_MS'] = previousTimeout;
  }
});

test('createTestEnvironmentConfig overlays overrides on the default config', () => {
  const config = createTestEnvironmentConfig({ username: 'tester', isHooksDisabled: true });
  expect(config.username).toBe('tester');
  expect(config.isHooksDisabled).toBe(true);
  expect(config.hookTimeoutMs).toBe(createDefaultEnvironmentConfig().hookTimeoutMs);
});

test('createTestEnvironmentConfig returns the defaults unchanged without overrides', () => {
  expect(createTestEnvironmentConfig()).toEqual(createDefaultEnvironmentConfig());
});
