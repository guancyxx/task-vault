// Vitest-only stub for the `obsidian` runtime. esbuild marks `obsidian` external at build
// time, so it is never bundled; unit suites that transitively import a module with runtime
// `obsidian` value-imports (Modal/Notice/…) still need those names to resolve. These are
// behavior-free placeholders — the suites here exercise pure logic, never the UI shells.
export class Notice {
  constructor(_message?: string, _timeout?: number) {}
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
