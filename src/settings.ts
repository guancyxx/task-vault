// Obsidian settings UI over ConfigService (FR-022, FR-039). Thin, manually verified; the config
// logic and defaults live obsidian-free in config.ts. Every label routes through the active
// translator, so the panel renders wholly in the current UI language and re-renders on a switch.

import { PluginSettingTab, Setting, type App, type Plugin, type SettingDefinition } from 'obsidian';
import type { AgentTokens, ConfigService } from './config';
import type { Lang, T } from './i18n';

const AGENTS: readonly (keyof AgentTokens)[] = ['hermes', 'cc', 'codex'];

// 32 hex chars = 16 random bytes. crypto is a desktop/Electron global (already used for UUIDs).
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class TaskVaultSettingTab extends PluginSettingTab {
  // onLangChange fires after the UI-language dropdown writes config, so the plugin can re-render
  // views + relabel commands without a reload (FR-039). getT returns the live translator.
  // onApiChange fires after any local-API setting writes, so the plugin can start/stop/restart
  // the http server live (FR-034).
  constructor(
    app: App,
    plugin: Plugin,
    private config: ConfigService,
    private getT: () => T,
    private onLangChange: () => void,
    private onApiChange: () => void,
  ) {
    super(app, plugin);
  }

  // Declarative settings API (Obsidian 1.13+): lets the in-app settings search index these
  // controls. Mirrors the names/descriptions rendered in display(); no runtime behavior change.
  getSettingDefinitions(): SettingDefinition[] {
    const t = this.getT();
    return [
      { name: t('settings.language'), description: t('settings.languageDesc') },
      { name: t('settings.projectsFolder'), description: t('settings.projectsFolderDesc') },
      { name: t('settings.dashboardFile'), description: t('settings.dashboardFileDesc') },
      { name: t('settings.terminalHook'), description: t('settings.terminalHookDesc') },
      { name: t('settings.dispatchHook'), description: t('settings.dispatchHookDesc') },
      { name: t('settings.alldayRemind'), description: t('settings.alldayRemindDesc') },
      { name: t('settings.backstop'), description: t('settings.backstopDesc') },
      { name: t('settings.apiEnabled'), description: t('settings.apiEnabledDesc') },
      { name: t('settings.apiPort'), description: t('settings.apiPortDesc') },
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

    // FR-041: where 新建项目 scaffolds. Read live by the command on each invocation, so an
    // edit here needs no restart.
    new Setting(containerEl)
      .setName(t('settings.projectsFolder'))
      .setDesc(t('settings.projectsFolderDesc'))
      .addText((ta) =>
        ta
          .setPlaceholder('01 Projects')
          .setValue(cfg.projects_folder)
          .onChange((v) => void this.config.update({ projects_folder: v })),
      );

    new Setting(containerEl)
      .setName(t('settings.dashboardFile'))
      .setDesc(t('settings.dashboardFileDesc'))
      .addText((ta) =>
        ta
          .setPlaceholder('Dashboard.md')
          .setValue(cfg.dashboard_file)
          .onChange((v) => void this.config.update({ dashboard_file: v })),
      );

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

    new Setting(containerEl).setName(t('settings.apiHeading')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.apiEnabled'))
      .setDesc(t('settings.apiEnabledDesc'))
      .addToggle((tg) =>
        tg.setValue(cfg.api_enabled).onChange((v) => {
          void this.config.update({ api_enabled: v }).then(() => this.onApiChange());
        }),
      );

    new Setting(containerEl)
      .setName(t('settings.apiPort'))
      .setDesc(t('settings.apiPortDesc'))
      .addText((ta) =>
        ta
          .setPlaceholder(String(cfg.api_port))
          .setValue(String(cfg.api_port))
          .onChange((v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n > 0 && n < 65536) {
              void this.config.update({ api_port: n }).then(() => this.onApiChange());
            }
          }),
      );

    // Tokens are read live by the running server on each auth check, so changing one needs no
    // restart — unlike the toggle/port, they don't call onApiChange.
    for (const agent of AGENTS) {
      new Setting(containerEl)
        .setName(t('settings.apiToken', { agent }))
        .setDesc(t('settings.apiTokenDesc', { agent }))
        .addText((ta) =>
          ta.setValue(cfg.agent_tokens[agent] ?? '').onChange((v) => {
            void this.config.update({ agent_tokens: { ...this.config.get().agent_tokens, [agent]: v } });
          }),
        )
        .addButton((b) =>
          b.setButtonText(t('settings.apiTokenGenerate')).onClick(() => {
            void this.config
              .update({ agent_tokens: { ...this.config.get().agent_tokens, [agent]: randomToken() } })
              .then(() => this.display()); // re-render so the new plaintext token shows in the field
          }),
        );
    }

    // Plaintext tokens in config.json — surface the risk right under the token rows.
    new Setting(containerEl).setDesc(t('settings.apiTokenWarning'));
  }
}
