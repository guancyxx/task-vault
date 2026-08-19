// Reschedule popover (FR-013): date/datetime dual-granularity picker. Uses the native
// `<input type=date|datetime-local>` (the OS calendar) rather than a picker library. Shared by
// the inline badge click and the detail popover's due field. onSubmit receives the formatted due
// (YYYY-MM-DD for all-day, YYYY-MM-DDTHH:MM for timed) or null to clear.

import { Modal, type App } from 'obsidian';

export type RescheduleSubmit = (due: string | null) => void;

export function openReschedule(app: App, currentDue: string | undefined, onSubmit: RescheduleSubmit): void {
  new RescheduleModal(app, currentDue, onSubmit).open();
}

class RescheduleModal extends Modal {
  private allDay: boolean;
  private input!: HTMLInputElement;

  constructor(app: App, private currentDue: string | undefined, private onSubmit: RescheduleSubmit) {
    super(app);
    this.allDay = currentDue ? !currentDue.includes('T') : true;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-reschedule-modal');
    this.setTitle('改期');

    const toggleRow = contentEl.createDiv({ cls: 'tv-reschedule' });
    const toggle = toggleRow.createEl('input', { attr: { type: 'checkbox' } });
    toggle.checked = this.allDay;
    toggleRow.createEl('label', { text: '全天（仅日期）' });
    toggle.addEventListener('change', () => {
      this.allDay = toggle.checked;
      this.renderInput();
    });

    this.renderInput();

    const btns = contentEl.createDiv({ cls: 'tv-reschedule' });
    const save = btns.createEl('button', { text: '保存' });
    save.addEventListener('click', () => this.submit());
    const clear = btns.createEl('button', { text: '清除' });
    clear.addEventListener('click', () => {
      this.onSubmit(null);
      this.close();
    });
  }

  private renderInput(): void {
    const existing = this.contentEl.querySelector('.tv-date-input');
    if (existing) existing.remove();
    const row = this.contentEl.createDiv({ cls: ['tv-reschedule', 'tv-date-input'] });
    this.input = row.createEl('input', {
      attr: { type: this.allDay ? 'date' : 'datetime-local' },
    });
    // Prefill from the current due, coercing to the active granularity.
    if (this.currentDue) {
      this.input.value = this.allDay ? this.currentDue.slice(0, 10) : toLocalInput(this.currentDue);
    }
  }

  private submit(): void {
    const v = this.input.value;
    if (!v) {
      this.onSubmit(null);
    } else {
      this.onSubmit(this.allDay ? v.slice(0, 10) : v.slice(0, 16));
    }
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// `datetime-local` wants `YYYY-MM-DDTHH:MM`; a date-only due becomes midnight.
function toLocalInput(due: string): string {
  return due.includes('T') ? due.slice(0, 16) : `${due.slice(0, 10)}T00:00`;
}
