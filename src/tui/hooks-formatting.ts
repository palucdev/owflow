import path from 'node:path';
import { scanHooks } from '../hooks/hooks-discovery.js';
import { HookDigestMode, HookRunState, type HookEventName, type HookRunLogRecord } from '../types/hook-types.js';
import { hooksDirectory } from '../utils/workflow-paths.js';
import type { SidebarTheme } from './primitives.js';

const ACTIVE_HOOKS_TITLE = 'Active hooks:';
const RUN_SUMMARY_MAX_CHARS = 4_000;

export interface ActiveHookRow {
  readonly name: string;
  readonly event: HookEventName;
}

export interface ActiveHooksView {
  readonly title: string;
  readonly rows: readonly ActiveHookRow[];
}

export const buildActiveHooksView = (directory: string): ActiveHooksView => {
  const scan = scanHooks(hooksDirectory(directory), { mode: HookDigestMode.Report });
  return {
    title: ACTIVE_HOOKS_TITLE,
    rows: scan.entries.map((entry) => ({
      name: path.basename(entry.path, path.extname(entry.path)),
      event: entry.event,
    })),
  };
};

export const statusLabelFor = (status: HookRunState | undefined): string => {
  switch (status) {
    case HookRunState.PENDING:
      return 'In progress';
    case HookRunState.SUCCESS:
      return 'Success';
    case HookRunState.FAILURE:
      return 'Error';
    default:
      return 'Idle';
  }
};

export const colorForStatus = (status: HookRunState | undefined, theme: SidebarTheme): unknown => {
  switch (status) {
    case HookRunState.PENDING:
      return theme.warning;
    case HookRunState.SUCCESS:
      return theme.success;
    case HookRunState.FAILURE:
      return theme.error;
    default:
      return theme.textMuted;
  }
};

const truncateMessage = (message: string, maxChars: number): string => {
  if (message.length <= maxChars) return message;
  const suffix = '\n[message truncated]';
  return message.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
};

export const formatHookRunSummary = (record: HookRunLogRecord, maxChars = RUN_SUMMARY_MAX_CHARS): string => {
  const timestamp = record.finishedAt || record.startedAt;
  const timeLabel = timestamp > 0 ? new Date(timestamp).toISOString() : 'none';
  const lines = [
    `Event:  ${record.event}`,
    `Status: ${statusLabelFor(record.status)} — ${record.durationMs} ms`,
    `Time:   ${timeLabel}`,
    `Session: ${record.sessionID ?? 'none'}`,
    `Exit:   ${record.exitCode ?? 'none'}`,
  ];
  return truncateMessage(lines.join('\n'), maxChars);
};

export const formatHookLogsMessage = (record: HookRunLogRecord): string => {
  const sections: string[] = [];
  if (record.stderr !== undefined && record.stderr.trim().length > 0) sections.push(`--- stderr ---\n${record.stderr.trimEnd()}`);
  if (record.stdout !== undefined && record.stdout.trim().length > 0) sections.push(`--- stdout ---\n${record.stdout.trimEnd()}`);
  if (sections.length === 0 && record.reason !== undefined && record.reason.trim().length > 0) sections.push(record.reason.trimEnd());
  if (sections.length === 0) sections.push('No output captured for this run.');
  return sections.join('\n\n');
};
