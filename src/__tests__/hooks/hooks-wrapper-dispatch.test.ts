import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import HooksWrapper from '../../hooks/hooks-wrapper.js';
import * as hooksPersistenceModule from '../../hooks/hooks-persistence.js';
import { HookEvent } from '../../types/hook-types.js';
import { cleanupWorkspaces, createWorkspace } from './hooks-test-helpers.js';
import { asDispatchHandlers } from './hooks-wrapper-test-helpers.js';

const NOOP = (): void => {};

afterEach(cleanupWorkspaces);

describe('HooksWrapper event dispatch', () => {
  test('createDispatchHandlers fans out host events, serializes catch-all event runs, and drops duplicate in-flight host events', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const wrapper = new HooksWrapper(workspace);
    const dispatchedEvents: string[] = [];
    const idleBarrier = Promise.withResolvers<void>();

    try {
      spyOn(wrapper, 'dispatch').mockImplementation(async (event) => {
        dispatchedEvents.push(event);
        if (event === 'session.idle') {
          await idleBarrier.promise;
        }
      });

      const handlers = asDispatchHandlers(wrapper.createDispatchHandlers());

      const first = handlers[HookEvent.Event]!({ event: { type: 'session.idle' } });
      // Emit two duplicate session.idle events while the first is still in-flight
      const second = handlers[HookEvent.Event]!({ event: { type: 'session.idle' } });
      const third = handlers[HookEvent.Event]!({ event: { type: 'session.idle' } });

      idleBarrier.resolve();
      await Promise.all([first, second, third]);

      expect(dispatchedEvents.filter((event) => event === 'session.idle')).toEqual(['session.idle']);
      expect(dispatchedEvents.filter((event) => event === 'event')).toEqual(['event', 'event', 'event']);
    } finally {
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper reactive event isolation', () => {
  test('createDispatchHandlers isolates reactive host event failures from crashing OpenCode event bus without leaking to console', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const wrapper = new HooksWrapper(workspace);
    const crashEvents: Array<{ source?: string; error: unknown }> = [];
    const crashSpy = spyOn(hooksPersistenceModule, 'writeHookCrashLog').mockImplementation((optionsOrWorkspace, ...rest) => {
      const source = typeof optionsOrWorkspace === 'object' ? optionsOrWorkspace.source : rest[0];
      const error = typeof optionsOrWorkspace === 'object' ? optionsOrWorkspace.error : rest[1];
      crashEvents.push({ source, error });
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(NOOP);

    try {
      spyOn(wrapper, 'dispatch').mockImplementation(async (event) => {
        if (event === 'session.idle') throw new Error('Blocked: idle check failed');
        if (event === HookEvent.Event) throw new Error('Blocked: catch-all event failed');
      });

      const handlers = asDispatchHandlers(wrapper.createDispatchHandlers());

      // Dispatching reactive event via host Event handler should NOT throw unhandled rejection
      await handlers[HookEvent.Event]!({ event: { type: 'session.idle' } });

      // Does not leak to console.warn / terminal in the working TUI
      expect(warnSpy).not.toHaveBeenCalled();
      // Records failures to persistent crash log instead
      expect(crashEvents.some((crashEvent) => crashEvent.source === 'reactive_host_event_session.idle')).toBe(true);
      expect(crashEvents.some((crashEvent) => crashEvent.source === 'catch_all_event_hook')).toBe(true);
    } finally {
      crashSpy.mockRestore();
      warnSpy.mockRestore();
      wrapper.dispose();
    }
  });
});

describe('HooksWrapper passthrough events', () => {
  test('createDispatchHandlers routes passthrough lifecycle events to dispatch', async () => {
    const workspace = createWorkspace('owflow-wrapper-unit-');
    const wrapper = new HooksWrapper(workspace);
    const dispatchedEvents: string[] = [];

    try {
      spyOn(wrapper, 'dispatch').mockImplementation(async (event) => {
        dispatchedEvents.push(event);
      });

      const handlers = asDispatchHandlers(wrapper.createDispatchHandlers());
      await handlers[HookEvent.CommandExecuteBefore]!({ command: 'ls' }, {});
      await handlers[HookEvent.ToolExecuteAfter]!({ tool: 'bash' }, {});

      expect(dispatchedEvents).toEqual([HookEvent.CommandExecuteBefore, HookEvent.ToolExecuteAfter]);
    } finally {
      wrapper.dispose();
    }
  });
});
