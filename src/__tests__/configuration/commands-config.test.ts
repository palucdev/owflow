import { describe, expect, spyOn, test } from "bun:test";
import { configureCommands } from "../../configuration/commands-config.js";
import type { OpenCodeConfig } from "../../types/opencode-types.js";
import * as fileUtil from "../../utils/file-util.js";

describe("configureCommands", () => {
  test("should initialize config.command object when command is undefined", () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(config.command).toBeDefined();
    expect(typeof config.command).toBe("object");
  });

  test("should populate config.command with markdown files from commands directory", () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(config.command.development).toBeDefined();
    expect(config.command.development!.template).toBeDefined();
    expect(config.command["quick-bugfix"]).toBeDefined();
  });

  test("should not overwrite existing command definitions configured by user", () => {
    const customCommand = {
      template: "custom template content",
      description: "custom user description",
    };
    const config = {
      command: {
        development: customCommand,
      },
    } as unknown as OpenCodeConfig;

    configureCommands(config);

    expect(config.command.development).toEqual(customCommand);
    expect(config.command["quick-bugfix"]).toBeDefined();
  });

  test("should correctly parse frontmatter attributes including description, agent, model, and subtask boolean", () => {
    const mockMarkdownFiles = [
      {
        data: {
          name: "cmd-full",
          description: "Full command description",
          agent: "custom-agent",
          model: "gpt-4",
          subtask: "true",
        },
        content: "Template for cmd-full",
      },
      {
        data: {
          name: "cmd-subtask-false",
          description: "Subtask false command",
          subtask: "false",
        },
        content: "Template for cmd-subtask-false",
      },
      {
        data: {
          // missing name - should be skipped
          description: "No name command",
        },
        content: "Template for no-name",
      },
    ];

    const spy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue(
      mockMarkdownFiles as any,
    );

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command["cmd-full"]).toEqual({
        template: "Template for cmd-full",
        description: "Full command description",
        agent: "custom-agent",
        model: "gpt-4",
        subtask: true,
      });

      expect(config.command["cmd-subtask-false"]).toEqual({
        template: "Template for cmd-subtask-false",
        description: "Subtask false command",
        subtask: false,
      });

      expect(config.command["undefined"]).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
