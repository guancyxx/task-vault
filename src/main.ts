import { FileSystemAdapter, Plugin, type WorkspaceLeaf } from 'obsidian';
import { ConfigService, DEFAULT_CONFIG, normalizeConfig, type Config } from './config';
import { EMPTY_LEDGER, HookRunner, NodeHookExec, normalizeLedger, type Ledger } from './hooks/hookRunner';
import { TaskVaultSettingTab } from './settings';
import { NodeJsonStore } from './store/jsonStore';
import { TaskActions } from './store/taskActions';
import { TaskStore } from './store/taskStore';
import { VaultSource, wireVaultEvents } from './store/vaultSource';
import { parseCapture } from './view/captureParse';
import { openLegend } from './view/legend';
import { openQuickLog } from './view/quickLogModal';
import { TaskVaultView, VIEW_TYPE_TASK_VAULT } from './view/sidebarView';

export { VIEW_TYPE_TASK_VAULT };

// `.taskvault/` sits at the vault root; shared with the Python syncer (contract §1).
function taskvaultDir(plugin: Plugin): string {
  const adapter = plugin.app.vault.adapter;
  const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  return `${base}/.taskvault`;
}

export default class TaskVaultPlugin extends Plugin {
  private store!: TaskStore;
  private config!: ConfigService;
  private actions!: TaskActions;

  async onload(): Promise<void> {
    const dir = taskvaultDir(this);
    this.config = new ConfigService(
      new NodeJsonStore<Config>(`${dir}/config.json`, DEFAULT_CONFIG, normalizeConfig),
    );
    await this.config.load();

    const hooks = new HookRunner({
      config: () => this.config.get(),
      ledger: new NodeJsonStore<Ledger>(`${dir}/ledger.json`, EMPTY_LEDGER, normalizeLedger),
      exec: new NodeHookExec(),
      now: () => new Date(),
    });

    const source = new VaultSource(this.app);
    this.store = new TaskStore(source, source);
    this.actions = new TaskActions(this.app, this.store, source, hooks);

    const onCapture = async (text: string, now: Date): Promise<void> => {
      const capture = parseCapture(text, now);
      if (capture) await source.createTaskFile(capture, now);
    };

        this.registerView(
      VIEW_TYPE_TASK_VAULT,
      (leaf) => new TaskVaultView(leaf, this.store, onCapture, this.actions),
    );

    for (const ref of wireVaultEvents(this.app, this.store)) this.registerEvent(ref);

    // Build the index once the vault's file list is ready, then let events keep it live.
    this.app.workspace.onLayoutReady(() => void this.store.scan());

    this.addSettingTab(new TaskVaultSettingTab(this.app, this, this.config));
    this.addRibbonIcon('checkbox-glyph', 'Open Task Vault', () => void this.activateView());
    this.addCommand({ id: 'open', name: 'Open', callback: () => void this.activateView() });
    this.addCommand({ id: 'legend', name: '图例', callback: () => openLegend(this.app) });
    // FR-027 / SC-011: quick-log against the active editor file — the sidebar popover only
    // covers sidebar rows, so editing a task doc mid-flight had no canonical entry point.
    this.addCommand({
      id: 'quick-log',
      name: '记一条执行记录',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'l' }],
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const path = file.path;
        // Gate on the store index, not a path heuristic: only files Task Vault actually
        // knows about (frontmatter id parsed) get the entry point.
        if (!this.store.entryByPath(path)) return false;
        if (!checking) openQuickLog(this.app, this.store, this.actions, path);
        return true;
      },
    });
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT, active: true });
      workspace.revealLeaf(leaf);
    }
  }
}
