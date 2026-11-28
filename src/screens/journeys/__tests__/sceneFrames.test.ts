import { describe, expect, it } from 'vitest';
import { frameSampler, type FrameHost } from '../sceneFrames';

// 1.21.0: frames are measured only inside a window (keepAlive), then the loop stops by itself.
// The browser is a fake clock with a queue of animation-frame callbacks.

function fakeFrames() {
  let clock = 1000;
  let next = 1;
  const queue = new Map<number, (now: number) => void>();
  let requested = 0;
  const host: FrameHost = {
    requestAnimationFrame: (callback) => {
      requested++;
      const id = next++;
      queue.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => queue.delete(id),
    now: () => clock,
  };
  /** Advances the clock by `dt` and runs the frame callbacks due. */
  const frame = (dt = 1000 / 60) => {
    clock += dt;
    const due = [...queue.values()];
    queue.clear();
    due.forEach((fn) => fn(clock));
  };
  return { host, frame, pending: () => queue.size, requested: () => requested, idle: (ms: number) => (clock += ms) };
}

describe('frameSampler: measures only while there is something to measure', () => {
  it('idle: no frame loop until a window opens', () => {
    const f = fakeFrames();
    const s = frameSampler(f.host, () => {});
    expect(s.running).toBe(false);
    expect(f.requested()).toBe(0);
  });

  it('measures each frame inside the window (the first one only sets the clock), then stops by itself', () => {
    const f = fakeFrames();
    const dts: number[] = [];
    const s = frameSampler(f.host, (dt) => dts.push(Math.round(dt)));
    s.keepAlive(100);
    expect(s.running).toBe(true);
    for (let i = 0; i < 10; i++) f.frame(20);
    expect(dts).toEqual([20, 20, 20, 20]);
    expect(s.running).toBe(false);
    expect(f.pending()).toBe(0);
  });

  it('keepAlive while running stretches the window without a second loop', () => {
    const f = fakeFrames();
    let count = 0;
    const s = frameSampler(f.host, () => count++);
    s.keepAlive(50);
    f.frame(20);
    s.keepAlive(50);
    s.keepAlive(50);
    expect(f.pending()).toBe(1);
    for (let i = 0; i < 10; i++) f.frame(20);
    expect(count).toBe(3);
    expect(s.running).toBe(false);
  });

  it('a new window after an idle stretch never measures across the gap', () => {
    const f = fakeFrames();
    const dts: number[] = [];
    const s = frameSampler(f.host, (dt) => dts.push(Math.round(dt)));
    s.keepAlive(40);
    for (let i = 0; i < 4; i++) f.frame(20);
    f.idle(5000);
    s.keepAlive(40);
    for (let i = 0; i < 4; i++) f.frame(20);
    expect(dts).toEqual([20, 20]);
  });

  it('stop cancels the pending frame and ignores later windows', () => {
    const f = fakeFrames();
    let count = 0;
    const s = frameSampler(f.host, () => count++);
    s.keepAlive(1000);
    f.frame();
    s.stop();
    expect(f.pending()).toBe(0);
    s.keepAlive(1000);
    f.frame();
    expect(s.running).toBe(false);
    expect(count).toBe(0);
  });

  it('stopping from inside a frame callback (the cap dropped) ends the loop at once', () => {
    const f = fakeFrames();
    let count = 0;
    const s = frameSampler(f.host, () => {
      count++;
      s.stop();
    });
    s.keepAlive(1000);
    for (let i = 0; i < 5; i++) f.frame();
    expect(count).toBe(1);
    expect(f.pending()).toBe(0);
  });
});
