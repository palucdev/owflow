import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import OwflowPlugin from "../index.js";
import { PLUGIN_VERSION } from "../utils/plugin-info.js";
import * as skillsConfig from "../configuration/skills-config.js";
import * as commandsConfig from "../configuration/commands-config.js";
import * as agentsConfig from "../configuration/agents-config.js";
import * as sessionCompaction from "../hooks/session-compaction.js";
import * as beforeTool from "../hooks/before-tool.js";
import * as dispatcherModule from "../hooks-wrapper/dispatcher.js";
import * as registryModule from "../hooks-wrapper/registry.js";
import {
  LOG_FILE_ENV,
  readHookLogRecords,
} from "../hooks-wrapper/hook-logs.js";
import type { Dispatcher } from "../hooks-wrapper/dispatcher.js";
import { verify_template } from "../tools/verify_template.js";
import { fork_task } from "../tools/fork_task.js";

const mockPluginInput = (directory: string) =>
  ({
    $: {} as any,
    directory,
    client: {} as any,
    project: {} as any,
    worktree: directory,
    experimental_workspace: {} as any,
    serverUrl: new URL("http://localhost"),
  }) as any;

describe("OwflowPlugin index", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-index-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should export default plugin factory", async () => {
    const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
    expect(plugin).toBeDefined();
    expect(plugin.tool).toBeDefined();
    expect(plugin.tool!.verify_template).toBe(verify_template);
    expect(plugin.tool!.fork_task).toBe(fork_task);
    expect(typeof plugin.config).toBe("function");
    expect(typeof plugin["experimental.session.compacting"]).toBe("function");
    expect(typeof plugin["chat.message"]).toBe("function");
    expect(typeof plugin["tool.execute.before"]).toBe("function");
  });

  describe("config hook", () => {
    test("should use small_model directly from input config if provided", async () => {
      const skillsSpy = spyOn(
        skillsConfig,
        "configureSkills",
      ).mockImplementation(() => {});
      const commandsSpy = spyOn(
        commandsConfig,
        "configureCommands",
      ).mockImplementation(() => {});
      const agentsSpy = spyOn(
        agentsConfig,
        "configureAgents",
      ).mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = { small_model: "test-haiku" };

        await plugin.config!(inputConfig as any);

        expect(skillsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(commandsSpy).toHaveBeenCalledWith(inputConfig as any);
        expect(agentsSpy).toHaveBeenCalledWith(
          inputConfig as any,
          "test-haiku",
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `[owflow] Starting plugin installation (v${PLUGIN_VERSION})...`,
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `[owflow] Plugin installation completed successfully (v${PLUGIN_VERSION}).`,
        );
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    test("should read small_model from project opencode.json if not in config", async () => {
      const opencodeJsonPath = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(
        opencodeJsonPath,
        JSON.stringify({ small_model: "file-haiku" }),
        "utf8",
      );

      const skillsSpy = spyOn(
        skillsConfig,
        "configureSkills",
      ).mockImplementation(() => {});
      const commandsSpy = spyOn(
        commandsConfig,
        "configureCommands",
      ).mockImplementation(() => {});
      const agentsSpy = spyOn(
        agentsConfig,
        "configureAgents",
      ).mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = {};

        await plugin.config!(inputConfig as any);

        expect(agentsSpy).toHaveBeenCalledWith(
          inputConfig as any,
          "file-haiku",
        );
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    test("should warn when reading opencode.json fails or has invalid JSON", async () => {
      const opencodeJsonPath = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(opencodeJsonPath, "invalid-json{", "utf8");

      const skillsSpy = spyOn(
        skillsConfig,
        "configureSkills",
      ).mockImplementation(() => {});
      const commandsSpy = spyOn(
        commandsConfig,
        "configureCommands",
      ).mockImplementation(() => {});
      const agentsSpy = spyOn(
        agentsConfig,
        "configureAgents",
      ).mockImplementation(() => {});
      const consoleWarnSpy = spyOn(console, "warn").mockImplementation(
        () => {},
      );
      const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const inputConfig = {};

        await plugin.config!(inputConfig as any);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Couldn't read or parse opencode.json config - small_model remains undefined",
        );
        expect(agentsSpy).toHaveBeenCalledWith(inputConfig as any, "");
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });
  });

  describe("experimental.session.compacting hook", () => {
    test("should delegate to rereadOrchestratorState with directory and output", async () => {
      const rereadSpy = spyOn(
        sessionCompaction,
        "rereadOrchestratorState",
      ).mockImplementation(async () => {});

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const output = { context: [] };

        await plugin["experimental.session.compacting"]!(
          { sessionID: "sess-test" },
          output,
        );

        expect(rereadSpy).toHaveBeenCalledWith(tmpDir, output);
      } finally {
        rereadSpy.mockRestore();
      }
    });
  });

  describe("chat.message and tool.execute.before hooks", () => {
    test("should track session agent on chat.message and pass to tool.execute.before", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      // Record chat message with custom agent
      await plugin["chat.message"]!(
        { sessionID: "sess-123", agent: "codebase-analyzer" },
        {} as any,
      );

      // Call tool.execute.before with destructive action for non-whitelisted agent
      const input = { tool: "bash", sessionID: "sess-123", callID: "c-1" };
      const output = { args: { command: "git reset --hard" } };

      await expect(
        plugin["tool.execute.before"]!(input, output),
      ).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "codebase-analyzer"',
      );
    });

    test("should default agent to 'main' when chat.message input.agent is undefined", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      await plugin["chat.message"]!({ sessionID: "sess-default" }, {} as any);

      const input = { tool: "bash", sessionID: "sess-default", callID: "c-2" };
      const output = { args: { command: "git stash" } };

      await expect(
        plugin["tool.execute.before"]!(input, output),
      ).rejects.toThrow(
        'Blocked: destructive command not permitted for agent "main"',
      );
    });

    test("should catch and ignore errors inside chat.message hook", async () => {
      const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

      // Pass an invalid object to trigger internal error if any, or test resilience
      const badInput = {
        get sessionID() {
          throw new Error("Session access error");
        },
      };

      await expect(
        plugin["chat.message"]!(badInput as any, {} as any),
      ).resolves.toBeUndefined();
    });

    test("should re-throw 'Blocked:' error from guardAgainstDestructiveActions", async () => {
      const guardSpy = spyOn(
        beforeTool,
        "guardAgainstDestructiveActions",
      ).mockImplementation(async () => {
        throw new Error("Blocked: custom block message");
      });

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const input = { tool: "bash", sessionID: "sess-test", callID: "c-3" };
        const output = { args: { command: "rm -rf /" } };

        await expect(
          plugin["tool.execute.before"]!(input, output),
        ).rejects.toThrow("Blocked: custom block message");
      } finally {
        guardSpy.mockRestore();
      }
    });

    test("should swallow non-'Blocked:' errors from guardAgainstDestructiveActions", async () => {
      const guardSpy = spyOn(
        beforeTool,
        "guardAgainstDestructiveActions",
      ).mockImplementation(async () => {
        throw new Error("Unexpected database connection error");
      });

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
        const input = { tool: "bash", sessionID: "sess-test", callID: "c-4" };
        const output = { args: { command: "ls" } };

        await expect(
          plugin["tool.execute.before"]!(input, output),
        ).resolves.toBeUndefined();
      } finally {
        guardSpy.mockRestore();
      }
    });
  });

  describe("hooks wrapper composition", () => {
    const wrapperHandlerKeys = [
      "tool.execute.after",
      "tool.definition",
      "chat.params",
      "chat.headers",
      "command.execute.before",
      "shell.env",
      "experimental.chat.messages.transform",
      "experimental.chat.system.transform",
      "experimental.compaction.autocontinue",
      "experimental.text.complete",
      "event",
      "dispose",
    ] as const;

    const builtInKeys = [
      "tool",
      "config",
      "experimental.session.compacting",
      "chat.message",
      "tool.execute.before",
    ] as const;

    type DispatchRecord = {
      readonly event: string;
      readonly input: unknown;
      readonly output: Record<string, unknown> | undefined;
    };

    const asRecord = (plugin: unknown): Record<string, unknown> =>
      plugin as Record<string, unknown>;

    const withHooksEnabled = async <T>(run: () => Promise<T>): Promise<T> => {
      const previous = process.env.OWFLOW_HOOKS_DISABLED;
      delete process.env.OWFLOW_HOOKS_DISABLED;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = previous;
      }
    };

    const withStatusFile = async <T>(
      file: string,
      run: () => Promise<T>,
    ): Promise<T> => {
      const previous = process.env.OWFLOW_HOOKS_STATUS_FILE;
      process.env.OWFLOW_HOOKS_STATUS_FILE = file;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env.OWFLOW_HOOKS_STATUS_FILE;
        else process.env.OWFLOW_HOOKS_STATUS_FILE = previous;
      }
    };

    const withLogFile = async <T>(
      file: string,
      run: () => Promise<T>,
    ): Promise<T> => {
      const previous = process.env[LOG_FILE_ENV];
      process.env[LOG_FILE_ENV] = file;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env[LOG_FILE_ENV];
        else process.env[LOG_FILE_ENV] = previous;
      }
    };

    const writeHookFile = (fileName: string, contents: string): string => {
      const hooksDir = path.join(tmpDir, ".owflow", "hooks");
      fs.mkdirSync(hooksDir, { recursive: true });
      const filePath = path.join(hooksDir, fileName);
      fs.writeFileSync(filePath, contents, "utf8");
      return filePath;
    };

    const writeHookFixture = (stem: string): void => {
      writeHookFile(`${stem}.sh`, "#!/bin/bash\n");
    };

    const stubDispatcher = (
      behavior?: (record: DispatchRecord) => void,
    ): Dispatcher => {
      return async (event, input, output) => {
        behavior?.({ event, input, output });
      };
    };

    test("should expose the 12 wrapper dispatch handlers when hooks are enabled", async () => {
      writeHookFixture("tool-execute-before");

      await withHooksEnabled(async () => {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

        for (const key of wrapperHandlerKeys) {
          expect(typeof asRecord(plugin)[key]).toBe("function");
        }
      });
    });

    test("should reject the plugin factory when a hook entry fails digest validation", async () => {
      writeHookFile("unknown-event.sh", "#!/bin/bash\n");

      await withHooksEnabled(async () => {
        await expect(
          OwflowPlugin(mockPluginInput(tmpDir)),
        ).rejects.toThrow(/\[owflow\] 1 invalid entry/);
      });
    });

    test("should abort the current session when a gate hook reports failed", async () => {
      writeHookFile(
        "tool-execute-before.sh",
        '#!/bin/bash\ncat >/dev/null\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"failed","reason":"gate broke"}\'\n',
      );
      const aborts: Array<{ path: { id: string } }> = [];
      const pluginInput = {
        ...mockPluginInput(tmpDir),
        client: {
          session: {
            abort: async (options: { path: { id: string } }) => {
              aborts.push(options);
            },
          },
        },
      };

      await withHooksEnabled(async () => {
        const plugin = await OwflowPlugin(pluginInput);
        const input = {
          tool: "bash",
          sessionID: "sess-failed-gate",
          callID: "call-failed-gate",
        };

        await expect(
          plugin["tool.execute.before"]!(input, { args: { command: "ls" } }),
        ).rejects.toThrow(/gate broke/);
        expect(aborts).toEqual([{ path: { id: "sess-failed-gate" } }]);
      });
    });

    test("should run the destructive guard before dispatching tool.execute.before", async () => {
      const order: string[] = [];
      const guardSpy = spyOn(
        beforeTool,
        "guardAgainstDestructiveActions",
      ).mockImplementation(async () => {
        order.push("guard");
      });
      const calls: DispatchRecord[] = [];
      const dispatcherSpy = spyOn(
        dispatcherModule,
        "createDispatcher",
      ).mockReturnValue(
        stubDispatcher((record) => {
          order.push(`dispatch:${record.event}`);
          calls.push(record);
        }),
      );

      try {
        await withHooksEnabled(async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
          const input = {
            tool: "bash",
            sessionID: "sess-order",
            callID: "call-order",
          };
          const output = { args: { command: "ls -la" } };

          await plugin["tool.execute.before"]!(input, output);

          expect(order).toEqual(["guard", "dispatch:tool.execute.before"]);
          expect(calls[0]?.event).toBe("tool.execute.before");
          expect(calls[0]?.input).toBe(input);
          expect(calls[0]?.output).toBe(output);
        });
      } finally {
        guardSpy.mockRestore();
        dispatcherSpy.mockRestore();
      }
    });

    test("should keep the built-in reminder first and append script context on compaction", async () => {
      const order: string[] = [];
      const rereadSpy = spyOn(
        sessionCompaction,
        "rereadOrchestratorState",
      ).mockImplementation(async (_directory, output) => {
        order.push("reread");
        output.context.push("built-in reminder");
      });
      const calls: DispatchRecord[] = [];
      const dispatcherSpy = spyOn(
        dispatcherModule,
        "createDispatcher",
      ).mockReturnValue(
        stubDispatcher((record) => {
          order.push(`dispatch:${record.event}`);
          calls.push(record);
          const context = record.output?.["context"];
          if (Array.isArray(context)) context.push("script context");
        }),
      );

      try {
        await withHooksEnabled(async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
          const input = { sessionID: "sess-compact" };
          const output: { context: string[]; prompt?: string } = { context: [] };

          await plugin["experimental.session.compacting"]!(input, output);

          expect(order).toEqual([
            "reread",
            "dispatch:experimental.session.compacting",
          ]);
          expect(output.context).toEqual([
            "built-in reminder",
            "script context",
          ]);
          expect(output.prompt).toBeUndefined();
          expect(calls[0]?.output).toBe(output);
        });
      } finally {
        rereadSpy.mockRestore();
        dispatcherSpy.mockRestore();
      }
    });

    test("should update the session map before chat.message dispatch and propagate gate errors", async () => {
      const dispatcherSpy = spyOn(
        dispatcherModule,
        "createDispatcher",
      ).mockReturnValue(
        stubDispatcher((record) => {
          if (record.event === "chat.message") {
            throw new Error("chat dispatch exploded");
          }
        }),
      );

      try {
        await withHooksEnabled(async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
          const chatInput = {
            sessionID: "sess-gate",
            agent: "codebase-analyzer",
          };

          await expect(
            plugin["chat.message"]!(chatInput as any, {} as any),
          ).rejects.toThrow("chat dispatch exploded");

          // The map update ran before the throwing dispatch: the destructive
          // guard now sees the tracked agent instead of the "main" default.
          await expect(
            plugin["tool.execute.before"]!(
              { tool: "bash", sessionID: "sess-gate", callID: "call-gate" },
              { args: { command: "git reset --hard" } },
            ),
          ).rejects.toThrow(
            'Blocked: destructive command not permitted for agent "codebase-analyzer"',
          );
        });
      } finally {
        dispatcherSpy.mockRestore();
      }
    });

    test("should configure first and swallow config dispatch errors with a log", async () => {
      const order: string[] = [];
      const calls: DispatchRecord[] = [];
      const skillsSpy = spyOn(
        skillsConfig,
        "configureSkills",
      ).mockImplementation(() => {
        order.push("skills");
      });
      const commandsSpy = spyOn(
        commandsConfig,
        "configureCommands",
      ).mockImplementation(() => {
        order.push("commands");
      });
      const agentsSpy = spyOn(
        agentsConfig,
        "configureAgents",
      ).mockImplementation(() => {
        order.push("agents");
      });
      const dispatcherSpy = spyOn(
        dispatcherModule,
        "createDispatcher",
      ).mockReturnValue(
        stubDispatcher((record) => {
          order.push(`dispatch:${record.event}`);
          calls.push(record);
          throw new Error("config script exploded");
        }),
      );
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, "log").mockImplementation(
        () => {},
      );

      try {
        await withHooksEnabled(async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
          const inputConfig = { small_model: "test-haiku" };

          await plugin.config!(inputConfig as any);

          expect(order).toEqual([
            "skills",
            "commands",
            "agents",
            "dispatch:config",
          ]);
          expect(calls[0]?.input).toBe(inputConfig);
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("[owflow]"),
          );
        });
      } finally {
        skillsSpy.mockRestore();
        commandsSpy.mockRestore();
        agentsSpy.mockRestore();
        dispatcherSpy.mockRestore();
        warnSpy.mockRestore();
        consoleLogSpy.mockRestore();
      }
    });

    test("should keep only the built-in hook shape and skip the scan when OWFLOW_HOOKS_DISABLED=1", async () => {
      const previous = process.env.OWFLOW_HOOKS_DISABLED;
      process.env.OWFLOW_HOOKS_DISABLED = "1";
      writeHookFixture("tool-execute-before");
      const scanSpy = spyOn(registryModule, "scanHooks");
      const dispatcherSpy = spyOn(dispatcherModule, "createDispatcher");
      const consoleLogSpy = spyOn(console, "log").mockImplementation(
        () => {},
      );

      try {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

        expect(Object.keys(plugin).sort()).toEqual([...builtInKeys].sort());
        for (const key of wrapperHandlerKeys) {
          expect(asRecord(plugin)[key]).toBeUndefined();
        }
        expect(typeof plugin.config).toBe("function");
        expect(typeof plugin["experimental.session.compacting"]).toBe(
          "function",
        );
        expect(typeof plugin["chat.message"]).toBe("function");
        expect(typeof plugin["tool.execute.before"]).toBe("function");
        expect(scanSpy).not.toHaveBeenCalled();
        expect(dispatcherSpy).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("OWFLOW_HOOKS_DISABLED=1"),
        );
      } finally {
        scanSpy.mockRestore();
        dispatcherSpy.mockRestore();
        consoleLogSpy.mockRestore();
        if (previous === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = previous;
      }
    });

    test("should write an empty runtime snapshot at initialization, clearing prior statuses", async () => {
      const statusFile = path.join(tmpDir, "runtime-status.json");
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          version: 1,
          pid: 1,
          workspace: tmpDir,
          updatedAt: 1,
          hooks: {
            event: { status: "success", startedAt: 1, finishedAt: 2 },
          },
        }),
        "utf8",
      );

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
          expect(typeof plugin.dispose).toBe("function");

          const snapshot = JSON.parse(
            fs.readFileSync(statusFile, "utf8"),
          ) as { hooks: Record<string, unknown>; workspace: string };
          expect(snapshot.hooks).toEqual({});
          expect(snapshot.workspace).toBe(tmpDir);
        });
      });
    });

    test("should persist one JSONL record per settled user hook run", async () => {
      writeHookFile(
        "tool-execute-before.sh",
        '#!/bin/bash\ncat >/dev/null\necho "hooked stderr" >&2\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"ok"}\'\n',
      );
      const statusFile = path.join(tmpDir, "logged-status.json");
      const logFile = path.join(tmpDir, "hook-logs.jsonl");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

            await plugin["tool.execute.before"]!(
              {
                tool: "bash",
                sessionID: "ses_logged",
                callID: "call-logged",
              },
              { args: { command: "ls" } },
            );

            const read = readHookLogRecords(logFile);
            expect(read.kind).toBe("ok");
            if (read.kind === "ok") {
              expect(read.records).toHaveLength(1);
              expect(read.records[0]).toMatchObject({
                event: "tool.execute.before",
                name: "tool-execute-before",
                status: "success",
                outcome: "ok",
                sessionID: "ses_logged",
                exitCode: 0,
                stderr: "hooked stderr\n",
              });
            }
          });
        });
      });
    });

    test("should keep a silent observe run out of the status snapshot and log", async () => {
      writeHookFile(
        "event.sh",
        '#!/bin/bash\ncat >/dev/null\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"ok"}\'\n',
      );
      const statusFile = path.join(tmpDir, "silent-event-status.json");
      const logFile = path.join(tmpDir, "silent-event-logs.jsonl");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

            await plugin.event!({ event: { type: "session.updated" } });
            await plugin.dispose?.();

            const snapshot = JSON.parse(
              fs.readFileSync(statusFile, "utf8"),
            ) as { hooks: Record<string, unknown> };
            expect(snapshot.hooks).toEqual({});

            // A no-op fire never creates the log file at all.
            expect(readHookLogRecords(logFile)).toEqual({ kind: "missing" });
          });
        });
      });
    });

    test("should report an observe run that logs even without a pending phase", async () => {
      writeHookFile(
        "event.sh",
        '#!/bin/bash\nenvelope="$(cat)"\nif [[ "$envelope" == *\'"type":"session.idle"\'* ]]; then\n  echo "[event-hook] building" >&2\nfi\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"ok"}\'\n',
      );
      const statusFile = path.join(tmpDir, "fired-event-status.json");
      const logFile = path.join(tmpDir, "fired-event-logs.jsonl");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

            await plugin.event!({ event: { type: "session.updated" } });
            await plugin.event!({ event: { type: "session.idle" } });
            await plugin.dispose?.();

            const snapshot = JSON.parse(
              fs.readFileSync(statusFile, "utf8"),
            ) as { hooks: Record<string, { status: string }> };
            expect(snapshot.hooks["event"]?.status).toBe("success");

            const read = readHookLogRecords(logFile);
            expect(read.kind).toBe("ok");
            if (read.kind === "ok") {
              expect(read.records).toHaveLength(1);
              expect(read.records[0]).toMatchObject({
                event: "event",
                status: "success",
                stderr: "[event-hook] building\n",
              });
            }
          });
        });
      });
    });

    test("should fire an event-named hook only for its matching host event", async () => {
      writeHookFile(
        "session-idle.sh",
        '#!/bin/bash\ncat >/dev/null\necho "idle fired" >&2\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"ok"}\'\n',
      );
      const statusFile = path.join(tmpDir, "session-idle-status.json");
      const logFile = path.join(tmpDir, "session-idle-logs.jsonl");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

            await plugin.event!({
              event: { type: "session.updated", properties: {} },
            });
            expect(fs.existsSync(logFile)).toBe(false);

            await plugin.event!({
              event: {
                type: "session.idle",
                properties: { sessionID: "ses_idle" },
              },
            });
            await plugin.dispose?.();

            const snapshot = JSON.parse(
              fs.readFileSync(statusFile, "utf8"),
            ) as { hooks: Record<string, { status: string }> };
            expect(snapshot.hooks["session.idle"]?.status).toBe("success");
            expect(snapshot.hooks["event"]).toBeUndefined();

            const read = readHookLogRecords(logFile);
            expect(read.kind).toBe("ok");
            if (read.kind === "ok") {
              expect(read.records).toHaveLength(1);
              expect(read.records[0]).toMatchObject({
                event: "session.idle",
                name: "session-idle",
                class: "observe",
                sessionID: "ses_idle",
                stderr: "idle fired\n",
              });
            }
          });
        });
      });
    });

    test("should record a silent successful event-named hook without requiring output", async () => {
      writeHookFile(
        "session-idle.sh",
        '#!/bin/bash\ncat >/dev/null\nprintf \'%s\' \'{"protocol":"owflow-hooks/1","status":"ok"}\'\n',
      );
      const statusFile = path.join(tmpDir, "silent-named-status.json");
      const logFile = path.join(tmpDir, "silent-named-logs.jsonl");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

            await plugin.event!({
              event: {
                type: "session.idle",
                properties: { sessionID: "ses_silent" },
              },
            });
            await plugin.dispose?.();

            const snapshot = JSON.parse(
              fs.readFileSync(statusFile, "utf8"),
            ) as { hooks: Record<string, { status: string }> };
            expect(snapshot.hooks["session.idle"]?.status).toBe("success");

            const read = readHookLogRecords(logFile);
            expect(read.kind).toBe("ok");
            if (read.kind === "ok") {
              expect(read.records).toHaveLength(1);
              expect(read.records[0]).toMatchObject({
                event: "session.idle",
                name: "session-idle",
                class: "observe",
                sessionID: "ses_silent",
                status: "success",
                outcome: "ok",
              });
              expect(read.records[0]?.stderr).toBeUndefined();
              expect(read.records[0]?.stdout).toBeUndefined();
            }
          });
        });
      });
    });

    test("should not write a status or log file when OWFLOW_HOOKS_DISABLED=1", async () => {
      const previous = process.env.OWFLOW_HOOKS_DISABLED;
      process.env.OWFLOW_HOOKS_DISABLED = "1";
      const statusFile = path.join(tmpDir, "disabled-status.json");
      const logFile = path.join(tmpDir, "disabled-logs.jsonl");

      try {
        await withStatusFile(statusFile, async () => {
          await withLogFile(logFile, async () => {
            const plugin = await OwflowPlugin(mockPluginInput(tmpDir));
            expect(fs.existsSync(statusFile)).toBe(false);
            expect(fs.existsSync(logFile)).toBe(false);
            expect(plugin.dispose).toBeUndefined();
          });
        });
      } finally {
        if (previous === undefined) delete process.env.OWFLOW_HOOKS_DISABLED;
        else process.env.OWFLOW_HOOKS_DISABLED = previous;
      }
    });

    test("should run the user dispose dispatch before flushing the status store", async () => {
      const marker = path.join(tmpDir, "dispose-called.txt");
      writeHookFile(
        "dispose.sh",
        `#!/bin/bash\ncat >/dev/null\nprintf 'called' >> "${marker}"\necho "dispose ran" >&2\nprintf '%s' '{"protocol":"owflow-hooks/1","status":"ok"}'\n`,
      );
      const statusFile = path.join(tmpDir, "dispose-status.json");

      await withHooksEnabled(async () => {
        await withStatusFile(statusFile, async () => {
          const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

          await plugin.dispose?.();

          expect(fs.readFileSync(marker, "utf8")).toBe("called");
          const snapshot = JSON.parse(
            fs.readFileSync(statusFile, "utf8"),
          ) as { hooks: Record<string, { status: string }> };
          expect(snapshot.hooks["dispose"]?.status).toBe("success");
        });
      });
    });

    test("should resolve with no-op wrapper handlers when the hooks directory is absent", async () => {
      await withHooksEnabled(async () => {
        const plugin = await OwflowPlugin(mockPluginInput(tmpDir));

        for (const key of wrapperHandlerKeys) {
          const handler = asRecord(plugin)[key];
          expect(typeof handler).toBe("function");
          await (handler as (input: unknown, output: unknown) => Promise<void>)(
            {},
            {},
          );
        }
      });
    });
  });
});
