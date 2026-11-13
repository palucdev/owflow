export interface EnvironmentConfig {
  readonly isHooksDisabled: boolean;
  readonly hookTimeoutMs: number | undefined;
  readonly isDebugEnabled: boolean;
  readonly templatesDirectory: string | undefined;
  readonly statusFilePath: string | undefined;
  readonly logFilePath: string | undefined;
  readonly username: string;
}

export const createDefaultEnvironmentConfig = (): EnvironmentConfig => {
  const { env: environmentVariables } = process;
  const rawTimeout = environmentVariables['OWFLOW_HOOK_TIMEOUT_MS'];
  const parsedTimeout = rawTimeout ? Number(rawTimeout) : undefined;

  return {
    isHooksDisabled: environmentVariables['OWFLOW_HOOKS_DISABLED'] === '1',
    hookTimeoutMs: Number.isFinite(parsedTimeout) ? parsedTimeout : undefined,
    isDebugEnabled: environmentVariables['OWFLOW_DEBUG'] === '1',
    templatesDirectory: environmentVariables['OWFLOW_TEMPLATES_DIR'],
    statusFilePath: environmentVariables['OWFLOW_STATUS_FILE'],
    logFilePath: environmentVariables['OWFLOW_LOG_FILE'],
    username: environmentVariables['USER'] ?? environmentVariables['USERNAME'] ?? 'default',
  };
};

export const defaultEnvironmentConfig = createDefaultEnvironmentConfig();

export const createTestEnvironmentConfig = (
  overrides?: Partial<EnvironmentConfig>,
): EnvironmentConfig => ({
  ...defaultEnvironmentConfig,
  ...overrides,
});
