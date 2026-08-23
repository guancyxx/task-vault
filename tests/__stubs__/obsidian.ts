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
  constructor(_app?: unknown) {}
  open(): void {}
  close(): void {}
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
