import { RelayHttpError, type LiveHandlers, type Transport } from '../vendor/sync.js';

/** Test doubles for the sync engine and service: timers, environment, relay, Web Locks, BroadcastChannel. */

export const RELAY = 'https://relay.example';

/** Timers that only run when the test says so. */
export function fakeTimers() {
  let n = 0;
  const pending = new Map<number, { fn: () => unknown; ms: number; repeat: boolean }>();
  return {
    pending,
    setTimeout: (fn: () => unknown, ms: number) => { const id = ++n; pending.set(id, { fn, ms, repeat: false }); return id; },
    clearTimeout: (id: unknown) => { pending.delete(id as number); },
    setInterval: (fn: () => unknown, ms: number) => { const id = ++n; pending.set(id, { fn, ms, repeat: true }); return id; },
    clearInterval: (id: unknown) => { pending.delete(id as number); },
    delays: () => [...pending.values()].filter((t) => !t.repeat).map((t) => t.ms),
    intervals: () => [...pending.values()].filter((t) => t.repeat).map((t) => t.ms),
  };
}

export function fakeEnv() {
  const listeners = { on: [] as (() => unknown)[], off: [] as (() => void)[] };
  return {
    listeners,
    isVisible: () => true,
    isOnline: () => true,
    onVisibility: () => {},
    onOnline: (fn: () => unknown) => listeners.on.push(fn),
    onOffline: (fn: () => void) => listeners.off.push(fn),
  };
}

/**
 * A relay that keeps entries in memory; `fail` makes an action answer with an HTTP status, and
 * `hold` (a promise) makes pushes wait for it.
 */
export function fakeRelay() {
  const entries: { seq: number; id: string; wall: number; c: string }[] = [];
  const sockets: LiveHandlers[] = [];
  const calls: string[] = [];
  const fail: Partial<Record<'push' | 'pull' | 'deleteRoom', number>> = {};
  const control: { hold: Promise<void> | null } = { hold: null };
  const check = (action: 'push' | 'pull' | 'deleteRoom') => {
    calls.push(action);
    if (fail[action]) throw new RelayHttpError(fail[action]!, 'x', 'forced');
  };
  const transport: Transport = {
    async push(_b, _r, _t, envelopes) {
      check('push');
      if (control.hold) await control.hold;
      for (const e of envelopes) if (!entries.some((x) => x.id === e.id)) entries.push({ ...e, seq: entries.length + 1 });
      return { head: entries.length, rejected: [] };
    },
    async pull(_b, _r, _t, after, limit) {
      check('pull');
      return { entries: entries.slice(after, after + limit), head: entries.length };
    },
    live(_b, _r, _t, _c, handlers) {
      sockets.push(handlers);
      handlers.onOpen?.();
      return { close: () => handlers.onClose(1000) };
    },
    async deleteRoom() {
      check('deleteRoom');
      return { deleted: true };
    },
  };
  return { entries, sockets, calls, fail, control, transport };
}

/** Web Locks as browsers do them (one holder per name, a queue, ifAvailable, abort), for several services in one test. */
export function fakeLocks() {
  const holders = new Map<string, Promise<unknown>>();
  const queues = new Map<string, (() => void)[]>();
  return {
    async request(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown>) {
      if (holders.has(name) && options.ifAvailable) return callback(null);
      if (holders.has(name)) {
        const queue = queues.get(name) ?? [];
        queues.set(name, queue);
        await new Promise<void>((resolve, reject) => {
          queue.push(resolve);
          options.signal?.addEventListener('abort', () => {
            queue.splice(queue.indexOf(resolve), 1);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      }
      const run = callback({});
      holders.set(name, run);
      try {
        return await run;
      } finally {
        holders.delete(name);
        queues.get(name)?.shift()?.();
      }
    },
  };
}

/** BroadcastChannel between services in one test: call the result once per tab. */
export function fakeChannels() {
  const all = new Set<{ listeners: ((e: { data: unknown }) => void)[] }>();
  return () => {
    const self = { listeners: [] as ((e: { data: unknown }) => void)[] };
    all.add(self);
    return {
      postMessage(data: unknown) {
        for (const other of all) if (other !== self) for (const fn of other.listeners) queueMicrotask(() => fn({ data: structuredClone(data) }));
      },
      addEventListener(_type: 'message', fn: (e: { data: unknown }) => void) { self.listeners.push(fn); },
      close() { all.delete(self); },
    };
  };
}
