// Obsidian settings UI over ConfigService (FR-022). Thin, manually verified; the config logic
// and defaults live obsidian-free in config.ts.

import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { ConfigService } from './config';

export class TaskVaultSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private config: ConfigService) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const cfg = this.config.get();

    new Setting(containerEl).setName('Hook 命令').setHeading();

    new Setting(containerEl)
      .setName('终态 hook (terminal)')
      .setDesc(
        '任务进入 done/cancelled 时执行。占位符 {TASK_PATH} {TASK_ID} {TASK_STATUS} {TASK_TITLE} {TASK_ASSIGNEE}，同时注入 TV_* 环境变量。留空 = 禁用。',
      )
      .addTextArea((t) =>
        t
          .setPlaceholder('例如：~/bin/on-task-done "{TASK_PATH}"')
          .setValue(cfg.terminal_hook)
          .onChange((v) => void this.config.update({ terminal_hook: v })),
      );

    new Setting(containerEl)
      .setName('派发 hook (dispatch)')
      .setDesc('委派任务给 agent 时执行。占位符同上，额外提供 {TASK_INSTRUCTION}。留空 = 禁用。')
      .addTextArea((t) =>
        t
          .setPlaceholder('例如：hermes dispatch --task "{TASK_ID}" --to "{TASK_ASSIGNEE}"')
          .setValue(cfg.dispatch_hook)
          .onChange((v) => void this.config.update({ dispatch_hook: v })),
      );

    new Setting(containerEl).setName('时间默认值').setHeading();

    new Setting(containerEl)
      .setName('全天任务默认提醒时刻')
      .setDesc('无具体时刻的任务，到期日的提醒时间（HH:MM）。')
      .addText((t) =>
        t
          .setPlaceholder('09:00')
          .setValue(cfg.default_remind.allday)
          .onChange((v) => void this.config.update({ default_remind: { ...cfg.default_remind, allday: v } })),
      );

    new Setting(containerEl)
      .setName('兜底派发阈值（分钟）')
      .setDesc('委派后经过此分钟数仍无接单记录，兜底 cron 补派。')
      .addText((t) =>
        t
          .setPlaceholder('30')
          .setValue(String(cfg.backstop_minutes))
          .onChange((v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) void this.config.update({ backstop_minutes: n });
          }),
      );
  }
}
