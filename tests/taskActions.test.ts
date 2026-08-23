import { beforeEach, describe, expect, it } from 'vitest';
// Import the stub directly: the vitest `obsidian` alias resolves to this same file, so the static
// `messages` array is shared with the Notice that TaskActions constructs at runtime.
import { Notice } from './__stubs__/obsidian';
import { TaskActions } from '../src/store/taskActions';
import { createT } from '../src/i18n';
import type { Task } from '../src/model/types';
import type { TaskStore } from '../src/store/taskStore';

// Minimal fakes: the notice paths under test never touch app/body/hooks, so behavior-free stubs
// suffice. entryByPath returns the task; isBlocked forces the "blocked, can't complete" branch.
function makeActions(t?: () => ReturnType<typeof createT>): TaskActions {
  const task: Task = { id: 'id-1', title: 't', status: 'doing', created: '2026-08-19T09:00' };
  const store = {
    entryByPath: () => ({ task }),
    isBlocked: () => true,
  } as unknown as TaskStore;
  const app = {} as never;
  const body = {} as never;
  const hooks = {} as never;
  return t
    ? new TaskActions(app, store, body, hooks, 'user', () => new Date(), t)
    : new TaskActions(app, store, body, hooks);
}

describe('TaskActions notices (FR-039 i18n)', () => {
  beforeEach(() => {
    Notice.messages = [];
  });

  it('defaults to Chinese (pure-logic default translator)', async () => {
    await makeActions().complete('a.md');
    expect(Notice.messages).toEqual(['被阻塞，无法完成']);
  });

  it('follows the injected translator (en)', async () => {
    await makeActions(() => createT('en')).complete('a.md');
    expect(Notice.messages).toEqual(["Blocked — can't complete"]);
  });

  it('localizes the illegal-transition notice via the injected translator', async () => {
    // doing → inbox is not a legal transition; the guard fires a localized notice.
    await makeActions(() => createT('en')).setStatus('a.md', 'inbox');
    expect(Notice.messages).toEqual(['Illegal transition: doing → inbox']);
  });
});
