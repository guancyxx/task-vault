// Runtime stub for the externalized `obsidian` module so vitest can import view modules
// (commands / projectsView / projectDetailView) for their PURE exports without pulling the real
// plugin API. Types still come from types/obsidian.d.ts; this only satisfies module resolution at
// test runtime. Classes are bare shells — tests exercise pure logic, never the DOM/UI methods.

export class Component {}
export class ItemView extends Component {
  constructor(_leaf?: unknown) {
    super();
  }
}
export class Modal {
  constructor(_app?: unknown) {}
  open(): void {}
  close(): void {}
  setTitle(_t: string): this {
    return this;
  }
}
export class Plugin extends Component {}
export class PluginSettingTab {
  constructor(_app?: unknown, _plugin?: unknown) {}
}
export class Setting {
  constructor(_el?: unknown) {}
}
export class Menu {}
export class Notice {
  constructor(_message?: string, _timeout?: number) {}
}
export class Vault {}
export class TFile {}
export class TAbstractFile {}
export class FileSystemAdapter {}

export function debounce<T extends unknown[]>(cb: (...args: T) => void): (...args: T) => void {
  return cb;
}
