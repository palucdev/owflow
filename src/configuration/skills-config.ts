import path from 'node:path';
import type { OpenCodeConfig } from '../types/opencode-types.js';
import { PLUGIN_ROOT } from '../utils/plugin-info.js';

export const configureSkills = (config: OpenCodeConfig): void => {
  config.skills ||= {};
  config.skills.paths ||= [];
  const skillsDirectory = path.join(PLUGIN_ROOT, 'skills');
  if (!config.skills.paths.includes(skillsDirectory)) {
    config.skills.paths.push(skillsDirectory);
  }
};
