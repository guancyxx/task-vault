import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiLifecycle } from '../src/api/lifecycle';
import { ApiServer } from '../src/api/server';

// A minimal listener: we only need it to bind a port and answer auth (401) so we can prove it's up.
// Write seams throw because these tests never reach them — they only exercise the socket lifecycle.
function makeServer(port: number): ApiServer {
  return new ApiServer({
    port: () => port,
    tokens: () => ({}),
    store: { byId: () => undefined },
    createTask: async () => {
      throw new Error('unused');
    },
    actionsFor: () => {
      throw new Error('unused');
    },
    now: () => new Date(),
    onError: () => {},
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = a && typeof a === 'object' ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

// A closed port refuses the connection → fetch rejects. A live listener answers 401.
async function refused(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/tasks/x`);
    return false;
  } catch {
    return true;
  }
}

async function up(port: number): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${port}/tasks/x`);
  return res.status === 401;
}

let life: ApiLifecycle | undefined;
afterEach(async () => {
  await life?.close();
  life = undefined;
});

describe('ApiLifecycle serialization', () => {
  it('rapid toggle open-close-open-changeport leaves no orphan; last op wins', async () => {
    const portA = await freePort();
    const portB = await freePort();
    const cfg = { enabled: true, port: portA };
    life = new ApiLifecycle(() => makeServer(cfg.port), () => cfg.enabled);

    await life.reconcile(); // open on A
    expect(await up(portA)).toBe(true);

    // Fire a burst without awaiting between — the classic interleave that orphaned a listener.
    cfg.enabled = false;
    const r1 = life.reconcile(); // close
    cfg.enabled = true;
    const r2 = life.reconcile(); // reopen on A
    cfg.port = portB;
    const r3 = life.reconcile(); // move to B
    await Promise.all([r1, r2, r3]);

    expect(await refused(portA)).toBe(true); // old port fully released, no orphan
    expect(await up(portB)).toBe(true); // final desired state is live
  });

  it('ends fully closed when the last op disables it', async () => {
    const portA = await freePort();
    const cfg = { enabled: true, port: portA };
    life = new ApiLifecycle(() => makeServer(cfg.port), () => cfg.enabled);

    await life.reconcile();
    const r1 = life.reconcile();
    cfg.enabled = false;
    const r2 = life.reconcile();
    await Promise.all([r1, r2]);

    expect(await refused(portA)).toBe(true);
  });

  it('same instance: close then reconcile rebinds cleanly', async () => {
    const portA = await freePort();
    const cfg = { enabled: true, port: portA };
    life = new ApiLifecycle(() => makeServer(cfg.port), () => cfg.enabled);

    await life.reconcile();
    expect(await up(portA)).toBe(true);
    await life.close();
    expect(await refused(portA)).toBe(true);
    await life.reconcile(); // start again on the same port — no leftover listener blocks it
    expect(await up(portA)).toBe(true);
  });
});
