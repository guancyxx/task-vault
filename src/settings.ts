// Obsidian settings UI over ConfigService (FR-022, FR-039). Thin, manually verified; the config
// logic and defaults live obsidian-free in config.ts. Every label routes through the active
// translator, so the panel renders wholly in the current UI language and re-renders on a switch.

import { PluginSettingTab, Setting, type App, type Plugin, type SettingDefinition } from 'obsidian';
import type { ConfigService } from './config';
import type { Lang, T } from './i18n';

export class TaskVaultSettingTab extends PluginSettingTab {
  // onLangChange fires after the UI-language dropdown writes config, so the plugin can re-render
  // views + relabel commands without a reload (FR-039). getT returns the live translator.
  constructor(
    app: App,
    plugin: Plugin,
    private config: ConfigService,
    private getT: () => T,
    private onLangChange: () => void,
  ) {
    super(app, plugin);
  }

  // Declarative settings API (Obsidian 1.13+): lets the in-app settings search index these
  // controls. Mirrors the names/descriptions rendered in display(); no runtime behavior change.
  getSettingDefinitions(): SettingDefinition[] {
    const t = this.getT();
    return [
      { name: t('settings.language'), description: t('settings.languageDesc') },
      { name: t('settings.terminalHook'), description: t('settings.terminalHookDesc') },
      { name: t('settings.dispatchHook'), description: t('settings.dispatchHookDesc') },
      { name: t('settings.alldayRemind'), description: t('settings.alldayRemindDesc') },
      { name: t('settings.backstop'), description: t('settings.backstopDesc') },
    ];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const cfg = this.config.get();
    const t = this.getT();

    new Setting(containerEl).setName(t('settings.interfaceHeading')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.language'))
      .setDesc(t('settings.languageDesc'))
      .addDropdown((d) =>
        d
          .addOption('auto', t('settings.langAuto'))
          .addOption('zh-CN', '简体中文')
          .addOption('en', 'English')
          .setValue(cfg.ui_language)
          .onChange((v) => {
            // Re-render the panel after the switch so its own labels flip to the new language too.
            void this.config.update({ ui_language: v as Lang }).then(() => {
              this.onLangChange();
              this.display();
            });
          }),
      );

    new Setting(containerEl).setName(t('settings.hooksHeading')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.terminalHook'))
      .setDesc(t('settings.terminalHookDesc'))
      .addTextArea((ta) =>
        ta
          .setPlaceholder(t('settings.terminalHookPlaceholder'))
          .setValue(cfg.terminal_hook)
          .onChange((v) => void this.config.update({ terminal_hook: v })),
      );

    new Setting(containerEl)
      .setName(t('settings.dispatchHook'))
      .setDesc(t('settings.dispatchHookDesc'))
      .addTextArea((ta) =>
        ta
          .setPlaceholder(t('settings.dispatchHookPlaceholder'))
          .setValue(cfg.dispatch_hook)
          .onChange((v) => void this.config.update({ dispatch_hook: v })),
      );

    new Setting(containerEl).setName(t('settings.timeHeading')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.alldayRemind'))
      .setDesc(t('settings.alldayRemindDesc'))
      .addText((ta) =>
        ta
          .setPlaceholder('09:00')
          .setValue(cfg.default_remind.allday)
          .onChange((v) => void this.config.update({ default_remind: { ...cfg.default_remind, allday: v } })),
      );

    new Setting(containerEl)
      .setName(t('settings.backstop'))
      .setDesc(t('settings.backstopDesc'))
      .addText((ta) =>
        ta
          .setPlaceholder('30')
          .setValue(String(cfg.backstop_minutes))
          .onChange((v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) void this.config.update({ backstop_minutes: n });
          }),
      );
  }
}
