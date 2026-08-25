// Vitest-only stub for the `obsidian` runtime. esbuild marks `obsidian` external at build
// time, so it is never bundled; unit suites that transitively import a module with runtime
// `obsidian` value-imports (Modal/Notice/…) still need those names to resolve. These are
// behavior-free placeholders — the suites here exercise pure logic, never the UI shells.
export class Notice {
  // Record shown messages so suites can assert on user-facing notice text (FR-039 i18n).
  static messages: string[] = [];
  constructor(message?: string, _timeout?: number) {
    if (message !== undefined) Notice.messages.push(message);
  }
}
export class Modal {
  // Record opened instances so suites can drive a modal's rendered DOM (contentEl +
  // private-method access) through the same fake-element style as the row tests.
  static instances: Modal[] = [];
  contentEl: HTMLElement = mkFakeEl();
  constructor(_app?: unknown) {
    Modal.instances.push(this as unknown as Modal);
  }
  open(): void {}
  close(): void {}
  setTitle(_title: string): void {}
}

// Minimal fake element for Modal.contentEl: createDiv/createSpan/createEl + empty().
// Behavior-free — suites assert on the produced tree, not on real DOM semantics.
export function mkFakeEl(): any {
  const el: any = {
    children: [] as any[],
    classes: [] as string[],
    text: '',
    attrs: {} as Record<string, string>,
    value: '',
    disabled: false,
    listeners: {} as Record<string, Array<(e?: any) => void>>,
    addEventListener(type: string, fn: (e?: any) => void) {
      (el.listeners[type] ??= []).push(fn);
    },
    empty() {
      el.children = [];
    },
    addClass(cls: string) {
      el.classes = [...new Set([...el.classes, cls])];
    },
    toggleClass(cls: string, on: boolean) {
      el.classes = on
        ? [...new Set([...el.classes, cls])]
        : el.classes.filter((c: string) => c !== cls);
    },
    querySelectorAll(selector: string): any[] {
      // Only `button` is needed by current callers; match by tag the fake always creates.
      const out: any[] = [];
      if (selector === 'button') {
        const go = (e: any): void => {
          for (const c of e.children ?? []) {
            if (c.listeners && typeof c.disabled === 'boolean' && 'text' in c) out.push(c);
            go(c);
          }
        };
        go(el);
      }
      return out;
    },
    createDiv(opts?: any) {
      return el.adopt(opts);
    },
    createSpan(opts?: any) {
      return el.adopt(opts);
    },
    createEl(_tag: string, opts?: any) {
      return el.adopt(opts);
    },
    adopt(opts: any) {
      const child = mkFakeEl();
      if (opts?.cls) {
        child.classes = Array.isArray(opts.cls) ? opts.cls : String(opts.cls).split(/\s+/);
      }
      if (opts?.text !== undefined) child.text = opts.text;
      if (opts?.attr) child.attrs = opts.attr;
      el.children.push(child);
      return child;
    },
  };
  return el;
}
export class Setting {
  constructor(_containerEl?: unknown) {}
}
export class PluginSettingTab {
  constructor(_app?: unknown, _plugin?: unknown) {}
}
export class ItemView {
  constructor(_leaf?: unknown) {}
}
export class Plugin {}
export class TFile {}
export class FileSystemAdapter {}

// --- H7 additions (merged superset): view-shell base classes + helpers needed by
// projectsView / projectDetailView imports. Behavior-free, same policy as above.
export class Component {}
export class Menu {}
export class Vault {}
export class TAbstractFile {}
export class AbstractInputSuggest<T> {
  constructor(_el: unknown, _items?: T[]) {}
}
export function debounce<T extends unknown[]>(cb: (...args: T) => void): (...args: T) => void {
  return cb;
}
