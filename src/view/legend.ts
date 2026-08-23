// Legend panel (FR-016, FR-022): status × glyph × color, time-badge meaning, delegation icon.
// A read-only Modal opened from the command palette. Pulls STATUS_META so the legend can never
// drift from what the rows actually render.

import { Modal, type App } from 'obsidian';
import { STATUSES, type Status } from '../model/types';
import type { T } from '../i18n';
import { DELEGATE_GLYPH, STATUS_META, statusLabel } from './taskRow';

// The blocked state is derived, not set by hand — call that out in the legend.
const LEGEND_HINT: Partial<Record<Status, 'legend.blockedHint'>> = {
  blocked: 'legend.blockedHint',
};

export class LegendModal extends Modal {
  constructor(app: App, private t: T) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = this.t;
    contentEl.empty();
    contentEl.addClass('tv-legend');
    this.setTitle(t('legend.title'));

    contentEl.createEl('h3', { text: t('legend.statusHeading') });
    for (const status of STATUSES) {
      const meta = STATUS_META[status];
      const row = contentEl.createDiv({ cls: 'tv-legend-row' });
      // Real 4px color rail sample — same painter + status class the rows render (FR-031):
      // two different elements (legend row vs task row) sharing one rail painter in CSS.
      // Status labels re-source via `t` so the legend follows the active language.
      row.createSpan({ cls: ['tv-legend-rail', `tv-status-${meta.cls}`] });
      row.createSpan({ cls: 'tv-glyph', text: meta.glyph });
      const hint = LEGEND_HINT[status] ? t(LEGEND_HINT[status]!) : '';
      row.createSpan({ cls: 'tv-legend-label', text: `${statusLabel(status, t)}${hint}` });
    }

    contentEl.createEl('h3', { text: t('legend.timeHeading') });
    // Badge samples mirror what time/timeRules.ts actually renders (kept literal); descriptions localize.
    this.badge(contentEl, 'tv-countdown', '剩 3h12m', t('legend.countdownDesc'));
    this.badge(contentEl, 'tv-overdue', '超期 2d', t('legend.overdueDesc'));

    contentEl.createEl('h3', { text: t('legend.delegateHeading') });
    const del = contentEl.createDiv({ cls: 'tv-legend-row' });
    del.createSpan({ cls: 'tv-delegate', text: DELEGATE_GLYPH });
    del.createSpan({ cls: 'tv-legend-label', text: t('legend.delegateDesc') });
  }

  private badge(parent: HTMLElement, cls: string, text: string, desc: string): void {
    const row = parent.createDiv({ cls: 'tv-legend-row' });
    row.createSpan({ cls: ['tv-badge', cls], text });
    row.createSpan({ cls: 'tv-legend-label', text: desc });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function openLegend(app: App, t: T): void {
  new LegendModal(app, t).open();
}
