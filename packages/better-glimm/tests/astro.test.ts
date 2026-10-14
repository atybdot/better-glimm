import { describe, expect, it, vi } from "vitest";
import { setupGlimmAstro } from "../src/astro.js";

describe("setupGlimmAstro sweep", () => {
  it("runs the commit at once and returns null without WebGL", () => {
    document.body.innerHTML = `<canvas id="glimm-canvas"></canvas>`;
    const canvas = document.getElementById("glimm-canvas") as HTMLCanvasElement;
    const api = setupGlimmAstro({ canvas });
    expect(api.controller).toBeNull();

    const commit = vi.fn<() => void>(() => {});
    expect(api.sweep(commit)).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
    api.destroy();
  });

  it("reuses the slot on repeat setup instead of double-binding", () => {
    document.body.innerHTML = `<canvas id="glimm-canvas"></canvas>`;
    const canvas = document.getElementById("glimm-canvas") as HTMLCanvasElement;
    const first = setupGlimmAstro({ canvas });
    const second = setupGlimmAstro({ canvas });
    expect(second.navigate).toBe(first.navigate);
    expect(second.sweep).toBe(first.sweep);
    first.destroy();
  });
});
