// Atomic JSON store for the shared `.taskvault/` files (contract §1/§3/§6).
// Both the TS plugin and the Python syncer read/write config.json + ledger.json, so every
// write goes temp+rename and every mutation re-reads first (see hookRunner). Backed by node fs
// (isDesktopOnly) rather than the Obsidian adapter so `.taskvault/` stays out of the md cache
// and we get a real atomic rename. Injectable interface keeps callers unit-testable.

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface JsonStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Missing/corrupt file → the normalized fallback, never a throw: a first run has no files yet.
export class NodeJsonStore<T> implements JsonStore<T> {
  constructor(
    private path: string,
    private fallback: T,
    private normalize: (raw: unknown) => T,
  ) {}

  async read(): Promise<T> {
    try {
      const txt = await fs.readFile(this.path, 'utf8');
      return this.normalize(JSON.parse(txt));
    } catch {
      return clone(this.fallback);
    }
  }

  async write(value: T): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, this.path);
  }
}
