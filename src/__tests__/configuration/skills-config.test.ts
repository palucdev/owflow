import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { configureSkills } from '../../configuration/skills-config.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';

describe('configureSkills', () => {
  const expectedSkillsDirectory = path.join(PLUGIN_ROOT, 'skills');

  test('should initialize skills and skills.paths when skills is undefined', () => {
    const config = {} as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills).toBeDefined();
    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
  });

  test('should initialize skills.paths when skills object exists but skills.paths is undefined', () => {
    const config = { skills: {} } as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
  });

  test('should append skills directory to existing paths list without modifying existing entries', () => {
    const existingPath = '/custom/skills/path';
    const config = {
      skills: {
        paths: [existingPath],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([existingPath, expectedSkillsDirectory]);
  });

  test('should not add duplicate skills directory if it is already present in skills.paths', () => {
    const config = {
      skills: {
        paths: [expectedSkillsDirectory],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDirectory]);
    expect(config.skills.paths).toHaveLength(1);
  });
});
