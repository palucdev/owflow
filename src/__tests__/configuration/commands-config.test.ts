import { describe, expect, spyOn, test } from "bun:test";
import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "../../utils/plugin-info.js";
import * as commandsConfig from "../../configuration/commands-config.js";
import { configureCommands } from "../../configuration/commands-config.js";
import type { OpenCodeConfig } from "../../types/opencode-types.js";
import * as fileUtil from "../../utils/file-util.js";

describe("configureCommands", () => {
  test("should not overwrite a maintained content command the user configured", () => {
    const customCommand = {
      template: "custom template content",
      description: "custom user description",
    };
    const config = {
      command: {
        "owflow:work": customCommand,
      },
    } as unknown as OpenCodeConfig;

    configureCommands(config);

    expect(config.command["owflow:work"]).toEqual(customCommand);
    expect(config.command["owflow:dev-bugfix"]).toBeDefined();
  });

  test("should not overwrite existing command definitions configured by user during synthesis", () => {
    const customCommand = {
      template: "custom template content",
      description: "custom user description",
    };
    const config = {
      command: {
        "owflow:dev-spec": customCommand,
      },
    } as unknown as OpenCodeConfig;

    // The static directory is stubbed out so only synthesis can register the
    // sibling command the assertion below inspects.
    const spy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue([] as any);

    try {
      configureCommands(config);

      expect(config.command["owflow:dev-spec"]).toEqual(customCommand);
      expect(config.command["owflow:dev-plan"]!.template).toContain(
        'name: "owflow:dev-plan"',
      );
    } finally {
      spy.mockRestore();
    }
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
    const skillSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([] as any);

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
      skillSpy.mockRestore();
    }
  });
});

describe("invocable skill frontmatter", () => {
  const skillsDir = path.join(PLUGIN_ROOT, "skills");

  const readSkill = (slug: string) => {
    const raw = fs.readFileSync(path.join(skillsDir, slug, "SKILL.md"), "utf8");
    return { slug, raw, data: matter(raw).data };
  };

  const allSkills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(readSkill);

  test.each(allSkills.map((skill) => skill.slug))(
    "should declare a prefixed name and a boolean user-invocable flag in %s",
    (slug) => {
      const { data } = readSkill(slug);
      const name = data.name as string;

      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
      expect(name.startsWith("owflow:")).toBe(true);
      expect(typeof data["user-invocable"]).toBe("boolean");
    },
  );
});

describe("renderCommandTemplate", () => {
  const CRLF = "\r\n";

  // The name is the template's only variable input, so it is also the only
  // source of name occurrences in the rendered body — exactly the two slots.
  const FRONTMATTER = {
    name: "owflow:dev-spec",
    description: "Controlled description for the digestion tests.",
    "user-invocable": true,
  };

  const EXPECTED_LINES = [
    "CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-spec skill immediately as your FIRST action.",
    "",
    "Use the Skill tool with these exact parameters:",
    'name: "owflow:dev-spec"',
    'prompt: "$ARGUMENTS"',
  ];

  const render = (): string =>
    commandsConfig.renderCommandTemplate(FRONTMATTER as any);

  const renderLines = (): string[] => render().split(CRLF);

  test("should never transform or strip the owflow prefix of the name slot", () => {
    const rendered = render();

    expect(rendered.split(FRONTMATTER.name).length - 1).toBe(2);
    expect(rendered).not.toContain('name: "dev-spec"');
    expect(rendered).not.toContain("invoke the dev-spec skill");
  });

  test("should emit exactly the five expected lines with no leading or trailing newline", () => {
    const rendered = render();

    expect(rendered).toBe(EXPECTED_LINES.join(CRLF));
    expect(rendered.split(CRLF)).toHaveLength(5);
    expect(renderLines()[1]).toBe("");
    expect(rendered.startsWith("CRITICAL")).toBe(true);
    expect(rendered.startsWith(CRLF)).toBe(false);
    expect(rendered.endsWith(CRLF)).toBe(false);
  });
});

describe("skill command registration", () => {
  const STATIC_COMMAND_NAMES = [
    "owflow:work",
    "owflow:reviews-code",
    "owflow:reviews-pragmatic",
    "owflow:reviews-production-readiness",
    "owflow:reviews-reality-check",
    "owflow:reviews-spec-audit",
  ];

  const INTERNAL_ENGINE_NAMES = [
    "owflow:codebase-analyzer",
    "owflow:docs-manager",
    "owflow:implementation-plan-executor",
    "owflow:implementation-verifier",
    "owflow:orchestrator-framework",
  ];

  const skill = (slug: string, data: Record<string, unknown>) =>
    ({ slug, data }) as any;

  test("should register a command for an invocable skill and none for an internal engine", () => {
    const staticSpy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue(
      [] as any,
    );
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      skill("dev-plan", {
        "user-invocable": true,
        name: "owflow:dev-plan",
        description: "Plan phase.",
      }),
      skill("docs-manager", {
        "user-invocable": false,
        name: "owflow:docs-manager",
        description: "Internal engine.",
      }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command["owflow:dev-plan"]!.template).toContain(
        'name: "owflow:dev-plan"',
      );
      expect(config.command["owflow:docs-manager"]).toBeUndefined();
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });

  test("should not treat a string user-invocable value as the boolean flag", () => {
    const staticSpy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue(
      [] as any,
    );
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      skill("dev-plan", {
        "user-invocable": "true",
        name: "owflow:dev-plan",
        description: "Plan phase.",
      }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command["owflow:dev-plan"]).toBeUndefined();
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });

  test("should register one command per invocable skill alongside the six content commands", () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(Object.keys(config.command)).toHaveLength(36);

    // Both totals fall out of disk state: one wrapper per invocable skill on
    // top of the maintained command files.
    const invocableSkills = commandsConfig
      .readSkillFrontmatter()
      .filter((entry) => entry.data["user-invocable"] === true);
    expect(invocableSkills).toHaveLength(30);
  });

  test("should let a maintained command win over a synthesized one with the same name", () => {
    const staticBody = "The maintained body for the colliding name.";
    const staticSpy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue([
      { data: { name: "owflow:dev-plan" }, content: staticBody },
    ] as any);
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      skill("dev-plan", {
        "user-invocable": true,
        name: "owflow:dev-plan",
        description: "Plan phase.",
      }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command["owflow:dev-plan"]!.template).toBe(staticBody);
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });

  test("should register the six static content commands and no internal engine", () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    for (const name of STATIC_COMMAND_NAMES) {
      expect(config.command[name]).toBeDefined();
      expect(config.command[name]!.template).toBeDefined();
    }
    for (const name of INTERNAL_ENGINE_NAMES) {
      expect(config.command[name]).toBeUndefined();
    }
  });

  test("should hand the palette a description free of trailing whitespace", () => {
    const { data } = matter(
      fs.readFileSync(
        path.join(PLUGIN_ROOT, "skills", "agents-md-generator", "SKILL.md"),
        "utf8",
      ),
    );
    const staticSpy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue(
      [] as any,
    );
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([skill("agents-md-generator", data)]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);
      const registered = config.command["owflow:agents-md-generator"]!;

      expect(registered.description).toBe(data.description.trimEnd());
      expect(registered.description).not.toMatch(/\s$/);
      // The folded scalar the trim exists for still parses with a trailing newline.
      expect(data.description).toMatch(/\s$/);
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });
});

// The reader has no try/catch on the read or parse path, so every filesystem and
// parsing failure has to reach the caller instead of degrading to an empty list.
describe("reader failure classes", () => {
  test("should throw when the skills directory cannot be listed", () => {
    const readdirSpy = spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error(
        "ENOENT: no such file or directory, scandir 'owflow/skills'",
      );
    });

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow("ENOENT");
    } finally {
      readdirSpy.mockRestore();
    }
  });

  test("should throw when a SKILL.md cannot be read", () => {
    const readdirSpy = spyOn(fs, "readdirSync").mockReturnValue([
      { name: "dev-spec", isDirectory: () => true },
    ] as any);
    const existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    const readFileSpy = spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied, open 'dev-spec/SKILL.md'");
    });

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow("EACCES");
    } finally {
      readFileSpy.mockRestore();
      existsSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });

  test("should throw when a SKILL.md carries unparseable frontmatter", () => {
    const readdirSpy = spyOn(fs, "readdirSync").mockReturnValue([
      { name: "dev-spec", isDirectory: () => true },
    ] as any);
    const existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    const readFileSpy = spyOn(fs, "readFileSync").mockReturnValue(
      '---\nname: "owflow:dev-spec"\nargument-hint: [unclosed\n---\n\nbody',
    );

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow();
    } finally {
      readFileSpy.mockRestore();
      existsSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });

  test("should skip only the entries with no SKILL.md and read the rest", () => {
    const skillsDir = path.join(PLUGIN_ROOT, "skills");
    const skillFile = path.join(skillsDir, "dev-spec", "SKILL.md");
    // A file entry is given a resolvable SKILL.md path too, so only the
    // is-directory guard can skip it — otherwise the existsSync guard below
    // would hide that branch.
    const fileEntryPath = path.join(skillsDir, "notes.md", "SKILL.md");
    // Captured before the spy so the surviving entry is parsed from the real
    // file rather than a fabricated frontmatter.
    const realReadFileSync = fs.readFileSync;
    const readdirSpy = spyOn(fs, "readdirSync").mockReturnValue([
      { name: "assets", isDirectory: () => true },
      { name: "notes.md", isDirectory: () => false },
      { name: "dev-spec", isDirectory: () => true },
    ] as any);
    const existsSpy = spyOn(fs, "existsSync").mockImplementation(
      ((target: string) =>
        target === skillFile || target === fileEntryPath) as any,
    );
    const readFileSpy = spyOn(fs, "readFileSync").mockImplementation(((
      target: string,
      encoding: BufferEncoding,
    ) => realReadFileSync(target, encoding)) as any);

    try {
      const skills = commandsConfig.readSkillFrontmatter();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.slug).toBe("dev-spec");
      expect(skills[0]!.data.name).toBe("owflow:dev-spec");
      expect(skills[0]!.data["user-invocable"]).toBe(true);
    } finally {
      readFileSpy.mockRestore();
      existsSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });
});

describe("synthesized command contract", () => {
  test("should register a command carrying only the template and the description", () => {
    const staticSpy = spyOn(fileUtil, "loadMarkdownDir").mockReturnValue(
      [] as any,
    );
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      {
        slug: "dev-plan",
        data: {
          "user-invocable": true,
          name: "owflow:dev-plan",
          description: "Plan phase.",
          // None of these belong on a command; the synthesized value must not
          // forward them the way the static loop maps agent/model/subtask.
          "argument-hint": "[task description]",
          agent: "custom-agent",
          model: "gpt-4",
          subtask: "true",
        },
      } as any,
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);
      const registered = config.command["owflow:dev-plan"]!;

      expect(Object.keys(registered).sort()).toEqual([
        "description",
        "template",
      ]);
      expect(registered.description).toBe("Plan phase.");
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });

  test("should name every missing required key when a skill breaks the contract", () => {
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      { slug: "dev-spec", data: { "user-invocable": true } } as any,
    ]);

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow(
        "Skill 'dev-spec' is user-invocable but is missing required frontmatter: name, description",
      );
    } finally {
      readerSpy.mockRestore();
    }
  });

  test("should report a non-string required value as a missing key", () => {
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      {
        slug: "dev-spec",
        data: {
          "user-invocable": true,
          name: "owflow:dev-spec",
          // Unquoted YAML makes this a number; the guard has to reject it
          // before the renderer calls a string method on it.
          description: 2026,
        },
      } as any,
    ]);

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow(
        "missing required frontmatter: description",
      );
    } finally {
      readerSpy.mockRestore();
    }
  });

  test("should treat an empty required value as a missing key", () => {
    const readerSpy = spyOn(
      commandsConfig,
      "readSkillFrontmatter",
    ).mockReturnValue([
      {
        slug: "dev-spec",
        data: {
          "user-invocable": true,
          name: "owflow:dev-spec",
          description: "",
        },
      } as any,
    ]);

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow(
        "missing required frontmatter: description",
      );
    } finally {
      readerSpy.mockRestore();
    }
  });
});
