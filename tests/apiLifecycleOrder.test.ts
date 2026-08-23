import { describe, expect, it } from 'vitest';
import { ApiLifecycle } from '../src/api/lifecycle';

// Deterministic ordering tests for the serialization + generation contract (audit re-review
// asked for tests that fail if the mutex/generation logic is removed). Sockets can't prove
// this reliably in single-threaded JS — the old-port orphan is already prevented by apply()'s
// close-before-open shape. What the queue + generation actually add:
//   1. never a start() while a close() is still in flight (no transient double-bind), and
//   2. a reconcile superseded by a newer one skips its start() entirely.
// These fakes make both observable via deferred promises.

// Cast seam: ApiLifecycle only calls start()/close() on the server it holds; the test
// substitutes a controllable fake. Structural mismatch with the full ApiServer type is
// irrelevant to the ordering contract under test.
function fakeServerFactory(
  port: () => number,
  log: string[],
): () => import('../src/api/server').ApiServer {
  return () => {
    // Pin the port at construction time — a real ApiServer binds its port when made,
    // so a later port change must not relabel an already-bound server's log lines.
    const bound = port();
    return {
      start() {
        log.push(`start:${bound}`);
      },
      close() {
        log.push(`close-begin:${bound}`);
        hooks.onCloseStart?.();
        // Delay resolution until the test allows it — holds the queue mid-operation.
        const p = deferred.pop();
        if (p) return p.promise;
        return Promise.resolve();
      },
    } as unknown as import('../src/api/server').ApiServer;
  };
}

const hooks: { onCloseStart?: () => void } = {};

const deferred: Array<{ promise: Promise<void>; resolve: () => void }> = [];

function holdNextClose(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  const h = { promise, resolve };
  deferred.push(h);
  return h;
}

describe('ApiLifecycle ordering contract', () => {
  it('serializes: no start() while a close() is still in flight', async () => {
    const log: string[] = [];
    let currentPort = 1;
    const life = new ApiLifecycle(
      fakeServerFactory(() => currentPort, log),
      () => true,
    );

    // Open on port 1 (no deferred → close resolves immediately).
    await life.reconcile();
    expect(log).toEqual(['start:1']);

    // Switch port; hold the close of server 1 open.
    const gate = holdNextClose();
    currentPort = 2;
    const r1 = life.reconcile(); // queues: close(1) [held] → start(2)
    await Promise.resolve(); // let the queue pick up the op
    // While close(1) has not resolved, start(2) must NOT have happened.
    expect(log).toEqual(['start:1', 'close-begin:1']);

    // A second reconcile arriving mid-close must also queue behind it — without the
    // serialization queue it would run apply() now, find `server` not yet nulled,
    // re-close it (resolving immediately from the empty deferred stack) and start(3)
    // while close(1) is still held. That is exactly the double-bind the mutex forbids.
    currentPort = 3;
    const r2 = life.reconcile();
    await Promise.resolve();
    expect(log).toEqual(['start:1', 'close-begin:1']); // still nothing new

    gate.resolve();
    await Promise.all([r1, r2]);
    // Queued ops apply in order; the later one (port 3) owns the final state, and the
    // superseded port-2 op skipped its start via the generation check.
    expect(log).toEqual(['start:1', 'close-begin:1', 'start:3']);
  });

  it('generation: a superseded reconcile never starts a listener', async () => {
    const log: string[] = [];
    let enabled = true;
    const life = new ApiLifecycle(
      fakeServerFactory(() => 1, log),
      () => enabled,
    );

    await life.reconcile(); // start:1
    // Burst: open→close→open→close without awaiting. Final state = disabled.
    const rs = [
      life.reconcile(),
      (enabled = false, life.reconcile()),
      (enabled = true, life.reconcile()),
      (enabled = false, life.reconcile()),
    ];
    await Promise.all(rs);

    // Exactly one start ever; the superseded opens must have been skipped.
    expect(log.filter((l) => l.startsWith('start')).length).toBe(1);
    expect(log[0]).toBe('start:1');
  });

  it('close() cancels a pending start from a queued reconcile', async () => {
    const log: string[] = [];
    const life = new ApiLifecycle(
      fakeServerFactory(() => 1, log),
      () => true,
    );

    await life.reconcile(); // start:1
    // Queue a reopen whose close is held, then close() (unload path).
    await life.close(); // closes server 1 first
    const gate = holdNextClose();
    const r1 = life.reconcile(); // queues: close(null→no-op)… start held? close of null server
    const r2 = life.close(); // supersedes r1's generation
    gate.resolve();
    await Promise.all([r1, r2]);
    // r1 was superseded by r2's generation bump → no second start.
    expect(log.filter((l) => l.startsWith('start')).length).toBe(1);
  });
});
