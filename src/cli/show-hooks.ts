#!/usr/bin/env bun
import path from "node:path";
import { scanHooks } from "../hooks-wrapper/registry.js";
import type { HookReportInput } from "../hooks-wrapper/report.js";
import { renderJson, renderTable } from "../hooks-wrapper/report.js";

export interface ShowHooksOptions {
  readonly cwd?: string;
  readonly argv?: readonly string[];
  readonly log?: (line: string) => void;
}

/**
 * Standalone would-load scan: a separate process can never read the live
 * in-process registry, so the CLI re-derives with the same pure modules and
 * reports invalid entries as rows instead of failing fast (R7.2/A6/A8).
 * The exit code carries the set's validity: 0 clean, 1 invalid.
 */
export const runShowHooks = (options: ShowHooksOptions = {}): number => {
  const cwd = options.cwd ?? process.cwd();
  const argv = options.argv ?? process.argv;
  const log = options.log ?? console.log;

  const anchor = path.join(cwd, ".owflow", "hooks");
  const scan = scanHooks(anchor, { mode: "report" });
  const input: HookReportInput = {
    entries: scan.registry.entries,
    failures: scan.failures,
  };

  log(argv.includes("--json") ? renderJson(input) : renderTable(input));
  return scan.failures.length > 0 ? 1 : 0;
};

if (import.meta.main) process.exit(runShowHooks());
