import { FileSystemAdapter, Notice, Plugin, type Command, type WorkspaceLeaf } from 'obsidian';
import { ApiLifecycle } from './api/lifecycle';
import { ApiServer } from './api/server';
import { ConfigService, DEFAULT_CONFIG, normalizeConfig, type Config } from './config';
import type { Actor } from './model/types';
import { EMPTY_LEDGER, HookRunner, NodeHookExec, normalizeLedger, type Ledger } from './hooks/hookRunner';
import { createT, resolveLang, type ResolvedLang, type T } from './i18n';
import { TaskVaultSettingTab } from './settings';
import { NodeJsonStore } from './store/jsonStore';
import { TaskActions } from './store/taskActions';
import { TaskStore } from './store/taskStore';
import { VaultSource, wireVaultEvents } from './store/vaultSource';
import { parseCapture } from './view/captureParse';
import { CAPTURE_COMMAND_ROW, COMMAND_ROWS, registerCommands } from './view/commands';
import { NewProjectModal, NewTaskModal, CREATE_COMMAND_ROWS } from './view/newProjectModal';
import { openLegend } from './view/legend';
import { AgendaVaultView, VIEW_TYPE_TASK_VAULT_AGENDA } from './view/agendaView';
import { CalendarVaultView, VIEW_TYPE_TASK_VAULT_CALENDAR } from './view/calendarView';
import { ProjectDetailView, VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL } from './view/projectDetailView';
import { ProjectVaultView, VIEW_TYPE_TASK_VAULT_PROJECTS } from './view/projectsView';
import { TaskVaultView, VIEW_TYPE_TASK_VAULT } from './view/sidebarView';

export {
  VIEW_TYPE_TASK_VAULT,
  VIEW_TYPE_TASK_VAULT_PROJECTS,
  VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL,
  VIEW_TYPE_TASK_VAULT_AGENDA,
  VIEW_TYPE_TASK_VAULT_CALENDAR,
};

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
  // FR-034: built-in localhost API. The lifecycle serializes every start/stop so a fast settings
  // toggle can never orphan a listener.
  private apiLifecycle!: ApiLifecycle;
  private apiSource!: VaultSource;
  private apiHooks!: HookRunner;
  // FR-039: current UI language + translator. Views/commands read `this.t` live via a getter,
  // so a language switch takes effect on the next render / palette open — no plugin reload.
  private lang: ResolvedLang = 'zh-CN';
  private t: T = createT('zh-CN');
  private commands: Command[] = [];
  // Ribbon icon element — kept so its tooltip (aria-label) can be relabeled on a language switch.
  private ribbonEl: HTMLElement | null = null;

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
    this.recomputeLang();
    const getT = (): T => this.t;

    const hooks = new HookRunner({
      config: () => this.config.get(),
      ledger: new NodeJsonStore<Ledger>(`${dir}/ledger.json`, EMPTY_LEDGER, normalizeLedger),
      exec: new NodeHookExec(),
      now: () => new Date(),
    });

    const source = new VaultSource(this.app);
    this.store = new TaskStore(source, source, () => new Date(), source);
    this.actions = new TaskActions(this.app, this.store, source, hooks, 'user', () => new Date(), getT);
    this.apiSource = source;
    this.apiHooks = hooks;
    this.apiLifecycle = new ApiLifecycle(
      () => this.makeApiServer(),
      () => this.config.get().api_enabled,
    );

    const onCapture = async (text: string, now: Date): Promise<void> => {
      const capture = parseCapture(text, now);
      if (capture) await source.createTaskFile(capture, now);
    };

    this.registerView(
      VIEW_TYPE_TASK_VAULT,
      (leaf) =>
        new TaskVaultView(leaf, this.store, onCapture, this.actions, () => new Date(), () =>
          void this.activateProjectsView(), getT, () => void this.activateAgendaView(),
        ),
    );

    // FR-035 项目面板 + 项目详情. The panel opens a detail leaf in the center; detail's 返回
    // button re-reveals the panel.
    this.registerView(
      VIEW_TYPE_TASK_VAULT_PROJECTS,
      (leaf) =>
        new ProjectVaultView(leaf, this.store, (project) => this.openProjectDetail(project), getT, () => new Date(), () =>
          void this.activateAgendaView(),
        ),
    );
    this.registerView(
      VIEW_TYPE_TASK_VAULT_PROJECT_DETAIL,
      (leaf) =>
        new ProjectDetailView(leaf, this.store, this.actions, () => void this.activateProjectsView(), getT),
    );

    // FR-036 日程面板 (右侧栏) + 日历月视图 (中间区). Agenda's 完整日历 button opens the calendar.
    this.registerView(
      VIEW_TYPE_TASK_VAULT_AGENDA,
      (leaf) =>
        new AgendaVaultView(leaf, this.store, () => void this.openCalendar(), getT, () => new Date(),
          () => this.lang, () => void this.activateView(), () => void this.activateProjectsView(),
        ),
    );
    this.registerView(
      VIEW_TYPE_TASK_VAULT_CALENDAR,
      (leaf) =>
        new CalendarVaultView(leaf, this.store, getT, () => new Date(), () => this.lang,
          () => void this.activateView(), () => void this.activateProjectsView(),
          () => void this.activateAgendaView(),
        ),
    );

    for (const ref of wireVaultEvents(this.app, this.store)) this.registerEvent(ref);

    // Build the index once the vault's file list is ready, then let events keep it live.
    this.app.workspace.onLayoutReady(() => void this.store.scan());

    this.addSettingTab(
      new TaskVaultSettingTab(this.app, this, this.config, getT, () => this.applyLanguage(), () =>
        void this.reconcileApi(),
      ),
    );

    // Start the local API if enabled (FR-034). onunload closes it.
    void this.reconcileApi();
    // 'vault' lucide icon — matches the Check Seal logo (vault door + check).
    this.ribbonEl = this.addRibbonIcon('vault', this.t('ribbon.open'), () => void this.activateView());
    // The three chrome commands + the six task commands. All names resolve via `this.t`; on a
    // language switch, applyLanguage() rewrites every .name (the palette re-reads it on open).
    this.commands = [
      this.addCommand({ id: 'open', name: this.t('cmd.open'), callback: () => void this.activateView() }),
      // FR-045: activate the sidebar and focus+select the capture box. Ungated plain callback.
      this.addCommand({
        id: CAPTURE_COMMAND_ROW.id,
        name: this.t(CAPTURE_COMMAND_ROW.nameKey),
        hotkeys: [{ modifiers: ['Mod', 'Shift'], key: CAPTURE_COMMAND_ROW.key }],
        callback: () => void this.activateCaptureView(),
      }),
      this.addCommand({ id: 'open-projects', name: this.t('cmd.openProjects'), callback: () => void this.activateProjectsView() }),
      this.addCommand({ id: 'open-agenda', name: this.t('cmd.openAgenda'), callback: () => void this.activateAgendaView() }),
      this.addCommand({ id: 'legend', name: this.t('cmd.legend'), callback: () => openLegend(this.app, this.t) }),
      // FR-040/FR-041: the two creation commands. Plain callbacks (no commandGate) — creation
      // doesn't depend on the active file. 新建任务 rides the same parseCapture → onCapture
      // seam as the sidebar box; 新建项目 scaffolds notes per the configured vault paths.
      // Table-driven (CREATE_COMMAND_ROWS) so ids/keys can't drift from the spec.
      ...(() => {
        const createRunners: Record<string, () => void> = {
          'new-task': () =>
            new NewTaskModal(
              this.app,
              this.store,
              async (capture, now) => void (await this.apiSource.createTaskFile(capture, now)),
              this.t,
            ).open(),
          'new-project': () =>
            new NewProjectModal(
              this.app,
              {
                projectsFolder: this.config.get().projects_folder,
                dashboardPath: this.config.get().dashboard_file,
                now: () => new Date(),
              },
              this.t,
            ).open(),
        };
        return CREATE_COMMAND_ROWS.map((row) =>
          this.addCommand({
            id: row.id,
            name: this.t(row.nameKey),
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: row.key }],
            callback: createRunners[row.id],
          }),
        );
      })(),
      // FR-032 / SC-013: the six task commands, each gated on the active file being an indexed
      // task, with default Mod+Shift L/D/C/K/S/A hotkeys.
      ...registerCommands(this, this.app, this.store, this.actions, getT),
    ];
  }

  onunload(): void {
    void this.apiLifecycle.close();
  }

  // Start/stop/restart the local API to match config (FR-034). Serialized through ApiLifecycle so a
  // rapid toggle never orphans a listener; a bind failure (e.g. EADDRINUSE) surfaces a Notice via
  // onError, never crashes.
  private reconcileApi(): Promise<void> {
    return this.apiLifecycle.reconcile();
  }

  private makeApiServer(): ApiServer {
    return new ApiServer({
      port: () => this.config.get().api_port,
      tokens: () => this.config.get().agent_tokens,
      store: this.store,
      createTask: (capture, now, actorSource) => this.apiSource.createTaskFile(capture, now, actorSource),
      actionsFor: (actor: Actor) =>
        new TaskActions(this.app, this.store, this.apiSource, this.apiHooks, actor, () => new Date(), () => this.t),
      now: () => new Date(),
      onError: (err) =>
        new Notice(this.t('api.portError', { port: this.config.get().api_port, err: String(err) })),
    });
  }

  // Resolve the effective language from config + Obsidian's UI language and rebuild the translator.
  private recomputeLang(): void {
    this.lang = resolveLang(this.config.get().ui_language, this.obsidianLocale());
    this.t = createT(this.lang);
  }

  // Obsidian's display language. There is no typed `moment`/`app.locale` in the local shim, so we
  // read the value Obsidian persists in localStorage ('language', e.g. 'zh', 'en'); `app.locale()`
  // is tried first if the runtime exposes it. Empty → resolveLang falls back to en.
  private obsidianLocale(): string {
    const fromApp = (this.app as { locale?: () => string }).locale?.();
    if (fromApp) return fromApp;
    try {
      return window.localStorage.getItem('language') ?? '';
    } catch {
      return '';
    }
  }

  // FR-039 live switch: recompute the translator, relabel commands, and re-render open views (they
  // read the getter at render time, so a store notify is enough — no reload).
  private applyLanguage(): void {
    this.recomputeLang();
    const nameKeyById: Record<string, Parameters<T>[0]> = {
      open: 'cmd.open',
      'open-projects': 'cmd.openProjects',
      'open-agenda': 'cmd.openAgenda',
      legend: 'cmd.legend',
      'new-task': 'cmd.newTask',
      'new-project': 'cmd.newProject',
    };
    nameKeyById[CAPTURE_COMMAND_ROW.id] = CAPTURE_COMMAND_ROW.nameKey;
    for (const row of COMMAND_ROWS) nameKeyById[row.id] = row.nameKey;
    for (const cmd of this.commands) {
      const key = nameKeyById[cmd.id];
      if (key) cmd.name = this.t(key);
    }
    // Obsidian drives the ribbon tooltip from aria-label — reset it so the hover text follows suit.
    this.ribbonEl?.setAttribute('aria-label', this.t('ribbon.open'));
    this.store.notify();
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

  // FR-045: activate the cockpit, creating the right-sidebar leaf when none exists (audit C2 —
  // getRightLeaf(false) returns null without creating, which silently killed the capture command's
  // "open the view first" fallback). Reveal + a view-state set is enough for the input to exist.
  private async activateOrCreateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(true);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  // FR-045: open/reveal the sidebar, then focus + select its capture box. activateOrCreateView
  // opens (or creates) the leaf when absent, so the input is present by the time we query for it.
  // Focus retries across a few animation frames — a single rAF is not always enough after the
  // view-state lands (audit C2), and it gives up into the captureNoView Notice.
  private async activateCaptureView(): Promise<void> {
    await this.activateOrCreateView();
    const focus = (attempt: number): void => {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT)[0];
      const input = leaf?.view.containerEl.querySelector('input.tv-capture') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      } else if (attempt < 30) {
        window.requestAnimationFrame(() => focus(attempt + 1));
      } else {
        new Notice(this.t('command.captureNoView'));
      }
    };
    window.requestAnimationFrame(() => focus(0));
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

  // Agenda panel lives beside the cockpit in the right sidebar (FR-036).
  private async activateAgendaView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT_AGENDA);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT_AGENDA, active: true });
      workspace.revealLeaf(leaf);
    }
  }

  // Full month calendar opens in the center (FR-036), reusing any existing calendar leaf.
  private async openCalendar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASK_VAULT_CALENDAR)[0];
    if (!leaf) leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TASK_VAULT_CALENDAR, active: true });
    workspace.revealLeaf(leaf);
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
