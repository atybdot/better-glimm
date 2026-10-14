import { describe, expect, it, vi } from "vitest";
import { playCoveredSweep, createCurtain, nextPaint } from "../src/covered.js";
import type { ShaderController } from "glimm";

function mockController(): ShaderController & { progress: number; alpha: number } {
  const state = { progress: 0, alpha: 0 };
  return {
    canvas: document.createElement("canvas"),
    ...state,
    get progress() {
      return state.progress;
    },
    set progress(v: number) {
      state.progress = v;
    },
    get alpha() {
      return state.alpha;
    },
    set alpha(v: number) {
      state.alpha = v;
    },
    setPalette: () => {},
    setBandTight: () => {},
    setDirection: () => {},
    setWaveAmount: () => {},
    setRippleAmount: () => {},
    setWaveSpeed: () => {},
    setBrightness: () => {},
    setSwellAmount: () => {},
    getProgress: () => state.progress,
    getAlpha: () => state.alpha,
    setProgress: (p: number) => {
      state.progress = p;
    },
    setAlpha: (a: number) => {
      state.alpha = a;
    },
    destroy: () => {},
  } as unknown as ShaderController & { progress: number; alpha: number };
}

describe("playCoveredSweep", () => {
  it("covers, holds for commit+paint, then reveals over the new page", async () => {
    document.body.innerHTML = `<div id="host" style="position:relative"></div>`;
    const host = document.querySelector("#host") as HTMLElement;
    const curtain = createCurtain(host);
    const ctrl = mockController();
    const order: string[] = [];

    // rAF polyfill: jsdom has no visual frames — tick asynchronously so
    // playSweep's rAF loop advances without recursing the stack.
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        order.push("raf");
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });

    const commit = vi.fn<() => Promise<void>>(async () => {
      order.push("commit");
    });

    const handle = playCoveredSweep(ctrl, curtain, commit, {
      sweepMs: 60,
      outroMs: 20,
      midpoint: 0.5,
    });
    // Cover phase must run before the commit.
    await handle.midpoint;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("raf"); // nextPaint ran around the commit
    expect(order).toContain("commit");

    await handle.done;
    // Reveal finished: curtain released, controller reset.
    expect(curtain.element.dataset.glimmCurtain).toBe("idle");
    expect(ctrl.getProgress()).toBe(0);
    raf.mockRestore();
    curtain.destroy();
  });

  it("nextPaint resolves even when the signal is already aborted", async () => {
    const c = new AbortController();
    c.abort();
    await expect(nextPaint(c.signal)).resolves.toBeUndefined();
  });

  it("interrupt cancels but preserves the curtain for the next sweep", async () => {
    document.body.innerHTML = `<div id="host2" style="position:relative"></div>`;
    const host = document.querySelector("#host2") as HTMLElement;
    const curtain = createCurtain(host);
    const ctrl = mockController();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });
    const commit = vi.fn<() => Promise<void>>(async () => {});
    const handle = playCoveredSweep(ctrl, curtain, commit, { sweepMs: 200 });
    handle.interrupt();
    await handle.done;
    // Preserved: curtain not hidden, promises still resolve.
    expect(curtain.element.dataset.glimmCurtain).not.toBe("idle");
    await expect(handle.midpoint).resolves.toBeUndefined();
    raf.mockRestore();
    curtain.destroy();
  });

  it("cancel hides the curtain and resets the controller", async () => {
    document.body.innerHTML = `<div id="host3" style="position:relative"></div>`;
    const host = document.querySelector("#host3") as HTMLElement;
    const curtain = createCurtain(host);
    const ctrl = mockController();
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 1;
      });
    const handle = playCoveredSweep(ctrl, curtain, async () => {}, { sweepMs: 200 });
    handle.cancel();
    await handle.done;
    expect(curtain.element.dataset.glimmCurtain).toBe("idle");
    raf.mockRestore();
    curtain.destroy();
  });
});
