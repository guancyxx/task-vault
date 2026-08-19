// Minimal ambient shim for the Obsidian API surface actually used by the plugin.
// The real `obsidian` package is a devDependency in the official template, but this
// repo mandates zero runtime deps and a locked devDependency set (esbuild/vitest/
// typescript/@types/node). esbuild externalizes `obsidian` at build time; this shim
// only satisfies `tsc --noEmit`. Extend as Phase C wires real UI.
declare module 'obsidian' {
  export abstract class Component {
    load(): void;
    onload(): void;
    unload(): void;
    onunload(): void;
    register(cb: () => void): void;
  }

  export interface WorkspaceLeaf {
    getViewState(): unknown;
    setViewState(state: unknown): Promise<void>;
  }

  export abstract class ItemView extends Component {
    app: App;
    containerEl: HTMLElement;
    leaf: WorkspaceLeaf;
    constructor(leaf: WorkspaceLeaf);
    abstract getViewType(): string;
    abstract getDisplayText(): string;
    getIcon(): string;
    protected onOpen(): Promise<void>;
    protected onClose(): Promise<void>;
  }

  export interface Command {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean;
    hotkeys?: Array<{ modifiers: string[]; key: string }>;
  }

  export abstract class Plugin extends Component {
    app: App;
    manifest: unknown;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement;
    addCommand(command: Command): Command;
    addSettingTab(tab: PluginSettingTab): void;
    registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => ItemView): void;
    registerEvent(ref: EventRef): void;
  }

  export interface Workspace {
    getLeavesOfType(type: string): WorkspaceLeaf[];
    getRightLeaf(split: boolean): WorkspaceLeaf | null;
    revealLeaf(leaf: WorkspaceLeaf): void;
    onLayoutReady(cb: () => void): void;
    openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void>;
    getActiveFile(): TFile | null;
  }

  export class TFile {
    path: string;
    basename: string;
    extension: string;
  }
  export abstract class TAbstractFile {
    path: string;
  }

  export interface EventRef {}

  export interface DataAdapter {
    getName(): string;
    mkdir(path: string): Promise<void>;
  }
  // Desktop-only adapter; exposes the vault's absolute base path (used for `.taskvault/`).
  export class FileSystemAdapter implements DataAdapter {
    getName(): string;
    getBasePath(): string;
  }

  export class Vault {
    adapter: DataAdapter;
    getName(): string;
    getMarkdownFiles(): TFile[];
    read(file: TFile): Promise<string>;
    create(path: string, data: string): Promise<TFile>;
    process(file: TFile, fn: (data: string) => string): Promise<string>;
    getAbstractFileByPath(path: string): TAbstractFile | null;
    createFolder(path: string): Promise<TAbstractFolder>;
    on(name: 'modify' | 'delete' | 'create', cb: (file: TAbstractFile) => void): EventRef;
    on(name: 'rename', cb: (file: TAbstractFile, oldPath: string) => void): EventRef;
    // Low-level: fires for ANY file change on disk, including external writes the editor
    // never sees (syncer, cron, Hermes write_file). Found missing in live verification.
    on(name: 'raw', cb: (path: string) => void): EventRef;
    offref(ref: EventRef): void;
  }

  // Cache-safe frontmatter mutation (contract §6): never rewrites the whole file.
  export interface FileManager {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
    renameFile(file: TAbstractFile, newPath: string): Promise<void>;
  }

  export interface App {
    workspace: Workspace;
    vault: Vault;
    fileManager: FileManager;
  }

  // ---------- UI: Modal / Menu / Setting / settings tab ----------

  export class Modal {
    app: App;
    contentEl: HTMLElement;
    titleEl: HTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
    onOpen(): void;
    onClose(): void;
    setTitle(title: string): this;
  }

  export interface MenuItem {
    setTitle(title: string): this;
    setIcon(icon: string | null): this;
    setChecked(checked: boolean): this;
    setDisabled(disabled: boolean): this;
    onClick(cb: () => void): this;
  }

  export class Menu {
    addItem(cb: (item: MenuItem) => void): this;
    addSeparator(): this;
    showAtMouseEvent(evt: MouseEvent): void;
    showAtPosition(pos: { x: number; y: number }): void;
  }

  export interface ValueComponent<T> {
    setValue(value: T): this;
    getValue(): T;
    onChange(cb: (value: T) => void): this;
  }
  export interface TextComponent extends ValueComponent<string> {
    setPlaceholder(placeholder: string): this;
    inputEl: HTMLInputElement;
  }
  export interface TextAreaComponent extends ValueComponent<string> {
    setPlaceholder(placeholder: string): this;
    inputEl: HTMLTextAreaElement;
  }
  export interface ToggleComponent extends ValueComponent<boolean> {}
  export interface ButtonComponent {
    setButtonText(text: string): this;
    setCta(): this;
    setWarning(): this;
    onClick(cb: () => void): this;
    buttonEl: HTMLButtonElement;
  }

  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(desc: string): this;
    setHeading(): this;
    addText(cb: (text: TextComponent) => void): this;
    addTextArea(cb: (text: TextAreaComponent) => void): this;
    addToggle(cb: (toggle: ToggleComponent) => void): this;
    addButton(cb: (button: ButtonComponent) => void): this;
  }

  export abstract class PluginSettingTab {
    app: App;
    containerEl: HTMLElement;
    constructor(app: App, plugin: Plugin);
    abstract display(): void;
    hide(): void;
  }

  export function debounce<T extends unknown[]>(
    cb: (...args: T) => void,
    timeout?: number,
    resetTimer?: boolean,
  ): (...args: T) => void;

  export class Notice {
    constructor(message: string, timeout?: number);
  }
}

// Obsidian augments the DOM with convenience helpers on HTMLElement.
interface DomElementInfo {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string | number | boolean | null>;
  href?: string;
  title?: string;
  placeholder?: string;
  type?: string;
  value?: string;
}
interface HTMLElement {
  empty(): void;
  setText(text: string): void;
  addClass(...classes: string[]): void;
  removeClass(...classes: string[]): void;
  toggleClass(classes: string | string[], value: boolean): void;
  createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    o?: DomElementInfo,
  ): HTMLElementTagNameMap[K];
  createDiv(o?: DomElementInfo | string): HTMLDivElement;
  createSpan(o?: DomElementInfo | string): HTMLSpanElement;
}
