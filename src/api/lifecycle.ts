// FR-034 lifecycle guard. Toggling the API on/off or changing the port fires reconcile() from the
// settings UI — and a user can do that faster than a listener closes. Without ordering, a stale
// close and a fresh start interleave and leave an orphan listener bound to the old port.
//
// Fix: every start/stop is chained onto one serial promise queue (mutex), so at most one operation
// touches the socket at a time — at most one listener ever exists. A generation counter lets an
// operation superseded by a newer reconcile skip its start(): no point opening a listener the next
// queued op would immediately close.

import type { ApiServer } from './server';

export class ApiLifecycle {
  private server: ApiServer | null = null;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(
    private makeServer: () => ApiServer,
    private enabled: () => boolean,
  ) {}

  // Bring the running listener in line with current config. Serialized: never interleaves with a
  // prior reconcile()/close(). Resolves once this op (or a newer one that supersedes it) settles.
  reconcile(): Promise<void> {
    const gen = ++this.generation;
    this.queue = this.queue.then(() => this.apply(gen));
    return this.queue;
  }

  private async apply(gen: number): Promise<void> {
    await this.server?.close();
    this.server = null;
    // A newer reconcile is already queued — it owns the final state; don't open a listener now.
    if (gen !== this.generation) return;
    if (!this.enabled()) return;
    const server = this.makeServer();
    server.start();
    this.server = server;
  }

  // Unconditional shutdown (onunload). Bumping the generation cancels any pending start.
  close(): Promise<void> {
    this.generation++;
    this.queue = this.queue.then(async () => {
      await this.server?.close();
      this.server = null;
    });
    return this.queue;
  }
}
