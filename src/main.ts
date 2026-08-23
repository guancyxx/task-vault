import { FileSystemAdapter, Plugin, type WorkspaceLeaf } from 'obsidian';
import { ConfigService, DEFAULT_CONFIG, normalizeConfig, type Config } from './config';
import { EMPTY_LEDGER, HookRunner, NodeHookExec, normalizeLedger, type Ledger } from './hooks/hookRunner';
import { TaskVaultSettingTab } from './settings';
import { NodeJsonStore } from './store/jsonStore';
import { TaskActions } from './store/taskActions';
import { TaskStore } from './store/taskStore';
import { VaultSource, wireVaultEvents } from './store/vaultSource';
import { parseCapture } from './view/captureParse';
import { registerCommands } from './view/commands';
import { openLegend } from './view/legend';
import { ProjectDetailView, VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL } from './view/projectDetailView';
import { ProjectVaultView, VIEW_TYPE_TASK_VAULT_PROJECTS } from './view/projectsView';
import { TaskVaultView, VIEW_TYPE_TASK_VAULT } from './view/sidebarView';

export { VIEW_TYPE_TASK_VAULT, VIEW_TYPE_TASK_VAULT_PROJECTS, VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL };

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

  // Obsidian's Plugin.onload is typed `void`; keep it synchronous and fire the async
  // bootstrap without returning a promise (Scorecard: no promise where void is expected).
  onload(): void {
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
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
    this.store = new TaskStore(source, source, () => new Date(), source);
    this.actions = new TaskActions(this.app, this.store, source, hooks);

    const onCapture = async (text: string, now: Date): Promise<void> => {
      const capture = parseCapture(text, now);
      if (capture) await source.createTaskFile(capture, now);
    };

    this.registerView(
      VIEW_TYPE_TASK_VAULT,
      (leaf) =>
        new TaskVaultView(leaf, this.store, onCapture, this.actions, () => new Date(), () =>
          void this.activateProjectsView(),
        ),
    );

    // FR-035 项目面板 + 项目详情. The panel opens a detail leaf in the center; detail's 返回
    // button re-reveals the panel.
    this.registerView(
      VIEW_TYPE_TASK_VAULT_PROJECTS,
      (leaf) => new ProjectVaultView(leaf, this.store, (project) => this.openProjectDetail(project)),
    );
    this.registerView(
      VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL,
      (leaf) =>
        new ProjectDetailView(leaf, this.store, this.actions, () => void this.activateProjectsView()),
    );

    for (const ref of wireVaultEvents(this.app, this.store)) this.registerEvent(ref);

    // Build the index once the vault's file list is ready, then let events keep it live.
    this.app.workspace.onLayoutReady(() => void this.store.scan());

    this.addSettingTab(new TaskVaultSettingTab(this.app, this, this.config));
    // 'vault' lucide icon — matches the Check Seal logo (vault door + check).
    this.addRibbonIcon('vault', 'Open Task Vault', () => void this.activateView());
    this.addCommand({ id: 'open', name: 'Open', callback: () => void this.activateView() });
    this.addCommand({ id: 'open-projects', name: '项目面板', callback: () => void this.activateProjectsView() });
    this.addCommand({ id: 'legend', name: '图例', callback: () => openLegend(this.app) });
    // FR-032 / SC-013: the six task commands (记一条 / 快捷标注 决策·评论·卡点 / 设置状态 / 委派),
    // each gated on the active file being an indexed task, with default Mod+Shift L/D/C/K/S/A hotkeys.
    registerCommands(this, this.app, this.store, this.actions);
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

  // Projects panel lives beside the cockpit in the right sidebar.
  private async activateProjectsView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT_PROJECTS);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT_PROJECTS, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  // Detail opens in the center (FR-035); project passed through view state. Reuses any
  // existing detail leaf (switching project updates it) instead of spawning one per click.
  private async openProjectDetail(project: string): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL)[0];
    if (!leaf) leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL, active: true, state: { project } });
    workspace.revealLeaf(leaf);
  }
}
