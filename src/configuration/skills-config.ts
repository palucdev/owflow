import path from "node:path";
import type { OpenCodeConfig } from "../types/opencode-types.js";
import { PLUGIN_ROOT } from "../constants.js";

export const configureSkills = (config: OpenCodeConfig): void => {
  config.skills = config.skills || {};
  config.skills.paths = config.skills.paths || [];
  const skillsDir = path.join(PLUGIN_ROOT, "skills");
  if (!config.skills.paths.includes(skillsDir)) {
    config.skills.paths.push(skillsDir);
  }
};
