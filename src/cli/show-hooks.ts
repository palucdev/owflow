#!/usr/bin/env bun
import {
  renderJson,
  renderTable,
  scanHooks,
} from "../hooks/user-hooks.js";
import {
  HookDigestMode,
  type HookReportInput,
} from "../types/hook-types.js";
import { hooksDirectory } from "../utils/workflow-paths.js";

export interface ShowHooksOptions {
  readonly cwd?: string;
  readonly argv?: readonly string[];
  readonly log?: (line: string) => void;
}

export const runShowHooks = (options: ShowHooksOptions = {}): number => {
  const cwd = options.cwd ?? process.cwd();
  const argv = options.argv ?? process.argv;
  const log = options.log ?? console.log;

  const scan = scanHooks(hooksDirectory(cwd), { mode: HookDigestMode.Report });
  const input: HookReportInput = {
    entries: scan.entries,
    failures: scan.failures,
  };

  log(argv.includes("--json") ? renderJson(input) : renderTable(input));
  return scan.failures.length > 0 ? 1 : 0;
};

if (import.meta.main) process.exit(runShowHooks());
