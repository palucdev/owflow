import path from 'node:path';
import { scanHooks } from '../hooks/user-hooks.js';
import { HookDigestMode, type HookEventName, type HookRunLogRecord, type HookRunState } from '../types/hook-types.js';
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

export const statusLabelFor = (status: HookRunState | undefined): string =>
  status === 'pending' ? 'In progress' : status === 'success' ? 'Success' : status === 'failure' ? 'Error' : 'Idle';

export const colorForStatus = (status: HookRunState | undefined, theme: SidebarTheme): unknown =>
  status === 'pending' ? theme.warning : status === 'success' ? theme.success : status === 'failure' ? theme.error : theme.textMuted;

const truncateMessage = (message: string, maxChars: number): string => {
  if (message.length <= maxChars) return message;
  const suffix = '\n[message truncated]';
  return message.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
};

export const formatHookRunSummary = (record: HookRunLogRecord, maxChars = RUN_SUMMARY_MAX_CHARS): string => {
  const lines = [
    `Event:  ${record.event}`,
    `Status: ${record.status === 'success' ? 'Success' : 'Error'} — ${record.durationMs} ms`,
    `Time:   ${new Date(record.finishedAt).toISOString()}`,
    ...(record.sessionID !== undefined ? [`Session: ${record.sessionID}`] : []),
    ...(record.exitCode !== undefined ? [`Exit:   ${record.exitCode ?? 'none'}`] : []),
    ...(record.signal ? [`Signal: ${record.signal}`] : []),
    ...(record.reason !== undefined ? ['', `Reason: ${record.reason}`] : []),
  ];
  return truncateMessage(lines.join('\n'), maxChars);
};

export const formatHookLogsMessage = (record: HookRunLogRecord): string => {
  const sections: string[] = [];
  if (record.stderr !== undefined) sections.push(`--- stderr ---\n${record.stderr}`);
  if (record.stdout !== undefined) sections.push(`--- stdout ---\n${record.stdout}`);
  if (sections.length === 0) sections.push('No output captured for this run.');
  if (record.truncated === true) sections.push('[output truncated]');
  return sections.join('\n\n');
};

export const formatSessionHookLogsMessage = (recordOrRecords: HookRunLogRecord | readonly HookRunLogRecord[]): string => {
  const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
  if (records.length === 0) return 'No output captured for this run.';
  if (records.length === 1) return formatHookLogsMessage(records[0]!);

  const parts: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const time = new Date(rec.finishedAt).toISOString();
    const status = rec.status === 'success' ? 'Success' : 'Error';
    const header = `=== Run #${i + 1} (${time}) — ${status} (${rec.durationMs} ms) ===`;
    parts.push(header);
    parts.push(formatHookLogsMessage(rec));
  }
  return parts.join('\n\n');
};
