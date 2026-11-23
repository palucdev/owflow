// workaround til something is not done with issue https://github.com/anomalyco/opencode/issues/24065

export interface OpenCodeConfig {
  agent: Record<string, unknown>;
  command: Record<string, OpenCodeCommand>;
  skills: { paths?: string[]; [key: string]: unknown };
  small_model?: string;
}

export interface OpenCodeCommand {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}
