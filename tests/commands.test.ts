import { describe, expect, it } from 'vitest';
import { TRANSITIONS } from '../src/model/statusMachine';
import { STATUSES, type Status } from '../src/model/types';
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

  it('returns no targets for terminal states (command Notices instead of opening)', () => {
    expect(statusTargets('done')).toEqual([]);
    expect(statusTargets('cancelled')).toEqual([{ to: 'todo', label: STATUS_LABEL.todo, glyph: STATUS_META.todo.glyph, cls: STATUS_META.todo.cls }]);
  });
});
