// workaround til something is not done with issue https://github.com/anomalyco/opencode/issues/24065

export interface OpenCodeConfig {
  agent: any;
  command: Record<string, OpenCodeCommand>;
  skills: any;
  small_model?: string;
}

export interface OpenCodeCommand {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}
