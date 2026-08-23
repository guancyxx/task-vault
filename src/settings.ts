// Obsidian settings UI over ConfigService (FR-022, FR-039). Thin, manually verified; the config
// logic and defaults live obsidian-free in config.ts. Labels use side-by-side「中文 / English」so
// the panel reads in either language without routing every string through the dictionary.

import { PluginSettingTab, Setting, type App, type Plugin, type SettingDefinition } from 'obsidian';
import type { ConfigService } from './config';
import type { Lang } from './i18n';

export class TaskVaultSettingTab extends PluginSettingTab {
  // onLangChange fires after the UI-language dropdown writes config, so the plugin can re-render
  // views + relabel commands without a reload (FR-039).
  constructor(app: App, plugin: Plugin, private config: ConfigService, private onLangChange: () => void) {
    super(app, plugin);
  }

  // Declarative settings API (Obsidian 1.13+): lets the in-app settings search index these
  // controls. Mirrors the names/descriptions rendered in display(); no runtime behavior change.
  getSettingDefinitions(): SettingDefinition[] {
    return [
      { name: '界面语言 / Language', description: '插件界面文案的显示语言。' },
      { name: '终态 hook / Terminal hook', description: '任务进入 done/cancelled 时执行的命令。' },
      { name: '派发 hook / Dispatch hook', description: '委派任务给 agent 时执行的命令。' },
      { name: '全天任务默认提醒时刻 / All-day default remind', description: '无具体时刻的任务，到期日的提醒时间（HH:MM）。' },
      { name: '兜底派发阈值（分钟） / Backstop dispatch (min)', description: '委派后经过此分钟数仍无接单记录，兜底 cron 补派。' },
    ];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const cfg = this.config.get();

    new Setting(containerEl).setName('界面 / Interface').setHeading();

    new Setting(containerEl)
      .setName('界面语言 / Language')
      .setDesc('插件界面文案的显示语言。「跟随 Obsidian / Auto」按 Obsidian 界面语言自动选择。')
      .addDropdown((d) =>
        d
          .addOption('auto', '跟随 Obsidian / Auto')
          .addOption('zh-CN', '简体中文')
          .addOption('en', 'English')
          .setValue(cfg.ui_language)
          .onChange((v) => {
            void this.config.update({ ui_language: v as Lang }).then(() => this.onLangChange());
          }),
      );

    new Setting(containerEl).setName('Hook 命令 / Hooks').setHeading();

    new Setting(containerEl)
      .setName('终态 hook / Terminal hook')
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
      .setName('派发 hook / Dispatch hook')
      .setDesc('委派任务给 agent 时执行。占位符同上，额外提供 {TASK_INSTRUCTION}。留空 = 禁用。')
      .addTextArea((t) =>
        t
          .setPlaceholder('例如：hermes dispatch --task "{TASK_ID}" --to "{TASK_ASSIGNEE}"')
          .setValue(cfg.dispatch_hook)
          .onChange((v) => void this.config.update({ dispatch_hook: v })),
      );

    new Setting(containerEl).setName('时间默认值 / Time defaults').setHeading();

    new Setting(containerEl)
      .setName('全天任务默认提醒时刻 / All-day default remind')
      .setDesc('无具体时刻的任务，到期日的提醒时间（HH:MM）。')
      .addText((t) =>
        t
          .setPlaceholder('09:00')
          .setValue(cfg.default_remind.allday)
          .onChange((v) => void this.config.update({ default_remind: { ...cfg.default_remind, allday: v } })),
      );

    new Setting(containerEl)
      .setName('兜底派发阈值（分钟） / Backstop dispatch (min)')
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
