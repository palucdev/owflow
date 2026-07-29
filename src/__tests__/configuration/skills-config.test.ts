import { describe, expect, test } from "bun:test";
import path from "node:path";
import { configureSkills } from "../../configuration/skills-config.js";
import { PLUGIN_ROOT } from "../../index.js";
import type { OpenCodeConfig } from "../../types/opencode-types.js";

describe("configureSkills", () => {
  const expectedSkillsDir = path.join(PLUGIN_ROOT, "skills");

  test("should initialize skills and skills.paths when skills is undefined", () => {
    const config = {} as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills).toBeDefined();
    expect(config.skills.paths).toEqual([expectedSkillsDir]);
  });

  test("should initialize skills.paths when skills object exists but skills.paths is undefined", () => {
    const config = { skills: {} } as OpenCodeConfig;
    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDir]);
  });

  test("should append skills directory to existing paths list without modifying existing entries", () => {
    const existingPath = "/custom/skills/path";
    const config = {
      skills: {
        paths: [existingPath],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([existingPath, expectedSkillsDir]);
  });

  test("should not add duplicate skills directory if it is already present in skills.paths", () => {
    const config = {
      skills: {
        paths: [expectedSkillsDir],
      },
    } as OpenCodeConfig;

    configureSkills(config);

    expect(config.skills.paths).toEqual([expectedSkillsDir]);
    expect(config.skills.paths.length).toBe(1);
  });
});
