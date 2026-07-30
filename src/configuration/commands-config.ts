import type { OpenCodeConfig } from "../types/opencode-types.js";
import { loadMarkdownDir } from "../utils/file-util.js";

export const configureCommands = (config: OpenCodeConfig): void => {
  config.command = config.command || {};
  for (const { data, content } of loadMarkdownDir("commands")) {
    const name = data.name;
    if (!name) continue;
    // Don't overwrite commands the user has explicitly configured
    if (config.command[name]) continue;
    config.command[name] = {
      template: content,
      ...(data.description && { description: data.description }),
      ...(data.agent && { agent: data.agent }),
      ...(data.model && { model: data.model }),
      ...(data.subtask !== undefined && {
        subtask: data.subtask === "true",
      }),
    };
  }
};
