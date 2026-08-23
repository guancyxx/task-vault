import { describe, expect, it } from 'vitest';
import { createT } from '../src/i18n';
import { TRANSITIONS } from '../src/model/statusMachine';
import { STATUSES, type Status } from '../src/model/types';
import { COMMAND_ROWS, commandGate } from '../src/view/commands';
import { STATUS_LABEL, STATUS_META, statusTargets } from '../src/view/taskRow';

// The 设置状态 command's target list (FR-032): derived from the legal-transition table, decorated
// with the label/glyph/color-class each button renders. This is the one piece of pure logic in the
// otherwise DOM-only commands module.
describe('statusTargets (FR-032 设置状态)', () => {
  it('mirrors TRANSITIONS order for every state', () => {
    for (const from of STATUSES) {
      expect(statusTargets(from).map((t) => t.to)).toEqual([...TRANSITIONS[from]]);
    }
  });

  it('decorates each target with its label, glyph and color class', () => {
    expect(statusTargets('doing')).toEqual(
      (['waiting', 'review', 'done', 'cancelled'] as Status[]).map((to) => ({
        to,
        label: STATUS_LABEL[to],
        glyph: STATUS_META[to].glyph,
        cls: STATUS_META[to].cls,
      })),
    );
  });

  it('done has no targets (command Notices); cancelled still offers reopen → todo', () => {
    expect(statusTargets('done')).toEqual([]);
    expect(statusTargets('cancelled')).toEqual([{ to: 'todo', label: STATUS_LABEL.todo, glyph: STATUS_META.todo.glyph, cls: STATUS_META.todo.cls }]);
  });
});

// FR-032 command table + gate (SC-013): the shipped registration iterates COMMAND_ROWS, so these
// assertions pin ids / names / default hotkey letters and the grey-out gate behavior.
describe('command registry (FR-032 六命令)', () => {
  it('registers exactly the six spec commands with L/D/C/K/S/A default keys', () => {
    expect(COMMAND_ROWS.map((r) => `${r.id}:${r.key}`)).toEqual([
      'quick-log:L',
      'log-decision:D',
      'log-comment:C',
      'log-blocker:K',
      'set-status:S',
      'delegate:A',
    ]);
    // name is now a dictionary key (FR-039): assert it resolves to a non-empty display string.
    const t = createT('zh-CN');
    for (const row of COMMAND_ROWS) expect(t(row.nameKey).length).toBeGreaterThan(0);
  });

  it('gate passes only indexed task paths (grey-out otherwise)', () => {
    const store = {
      entryByPath: (p: string) => (p === '03 Tasks/x/2026-08-23/t.md' ? ({ task: null, path: p, body: '' } as never) : undefined),
    };
    expect(commandGate(store, '03 Tasks/x/2026-08-23/t.md')).toBe('03 Tasks/x/2026-08-23/t.md');
    expect(commandGate(store, '99 other/note.md')).toBeNull();
    expect(commandGate(store, null)).toBeNull();
  });
});
