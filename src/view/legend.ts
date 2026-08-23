// Legend panel (FR-016, FR-022): status × glyph × color, time-badge meaning, delegation icon.
// A read-only Modal opened from the command palette. Pulls STATUS_META so the legend can never
// drift from what the rows actually render.

import { Modal, type App } from 'obsidian';
import { STATUSES, type Status } from '../model/types';
import { DELEGATE_GLYPH, STATUS_LABEL, STATUS_META } from './taskRow';

// The blocked state is derived, not set by hand — call that out in the legend.
const LEGEND_HINT: Partial<Record<Status, string>> = {
  blocked: '（依赖未完成，自动推导）',
};

export class LegendModal extends Modal {
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-legend');
    this.setTitle('Task Vault 图例');

    contentEl.createEl('h3', { text: '状态' });
    for (const status of STATUSES) {
      const meta = STATUS_META[status];
      const row = contentEl.createDiv({ cls: 'tv-legend-row' });
      // Real 4px color rail sample — same element + tv-status class the rows render (FR-031).
      row.createSpan({ cls: ['tv-legend-rail', `tv-status-${meta.cls}`] });
      row.createSpan({ cls: 'tv-glyph', text: meta.glyph });
      row.createSpan({ cls: 'tv-legend-label', text: `${STATUS_LABEL[status]}${LEGEND_HINT[status] ?? ''}` });
    }

    contentEl.createEl('h3', { text: '时间徽章' });
    this.badge(contentEl, 'tv-countdown', '剩 3h12m', '距截止不足 24h 的倒计时');
    this.badge(contentEl, 'tv-overdue', '超期 2d', '已过截止（done 永不显示）');

    contentEl.createEl('h3', { text: '委派' });
    const del = contentEl.createDiv({ cls: 'tv-legend-row' });
    del.createSpan({ cls: 'tv-delegate', text: DELEGATE_GLYPH });
    del.createSpan({ cls: 'tv-legend-label', text: '已委派给 agent（assignee ≠ 自己）' });
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

export function openLegend(app: App): void {
  new LegendModal(app).open();
}
