// Shared vanilla runner — Svelte, Vue, and Astro adapters run through this
// so setup fields and sweep state stay in one place.
//
// Each adapter stays a thin shell: create a controller, ensure a curtain
// host, then delegate cover/hold/reveal timing to `runVanillaSweep`.

import { createShader, playSweep, resolvePalette } from "glimm";
import type { ShaderController, SweepHandle, SweepOptions } from "glimm";
import { ensureCurtainHost, playCoveredSweep } from "./covered.js";
import type { Curtain } from "./covered.js";
import type { InterceptLinksOptions } from "./intercept.js";

export type ReducedMotionMode = "instant" | "sweep";

export type VanillaBaseSetup = {
  canvas: HTMLCanvasElement;
  defaults?: SweepOptions;
  intercept?: Omit<InterceptLinksOptions, "sweep">;
  reducedMotion?: ReducedMotionMode;
  onController?: (ctrl: ShaderController) => void;
};

export type ActiveHandle = SweepHandle & { interrupt?: () => void };

export type RunnerState = {
  active: ActiveHandle | null;
};

export function createRunnerState(): RunnerState {
  return { active: null };
}

export function trackHandle(state: RunnerState, handle: ActiveHandle | null): void {
  state.active = handle;
  if (handle) {
    void handle.done.finally(() => {
      if (state.active === handle) state.active = null;
    });
  }
}

/** Interrupt the in-flight sweep, preserving the curtain when possible. */
export function interruptActive(state: RunnerState): void {
  const current = state.active;
  state.active = null;
  if (!current) return;
  if (typeof current.interrupt === "function") current.interrupt();
  else current.cancel();
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function resolveInstantFallback(reducedMotion: ReducedMotionMode): boolean {
  return prefersReducedMotion() && reducedMotion === "instant";
}

export function createVanillaController(
  canvas: HTMLCanvasElement,
  defaults: SweepOptions,
  onController?: (ctrl: ShaderController) => void,
): ShaderController | null {
  const controller = createShader({
    canvas,
    palette: defaults.palette ? resolvePalette(defaults.palette) : undefined,
    bandTight: defaults.bandTight,
    direction: defaults.direction,
  });
  if (controller && onController) onController(controller);
  return controller;
}

/** No-op handle for instant fallbacks where interceptLinks expects a SweepHandle. */
export function noopSweepHandle(): SweepHandle {
  return {
    midpoint: Promise.resolve(),
    done: Promise.resolve(),
    cancel: () => {},
  };
}

export type RunSweepArgs = {
  state: RunnerState;
  controller: ShaderController | null;
  curtain: Curtain | null;
  defaults: SweepOptions;
  instantFallback: boolean;
  commit: (signal: AbortSignal) => void | Promise<void>;
  options?: SweepOptions;
};

/**
 * Single place for merged options, instant fallback, interruption,
 * and covered vs plain sweep selection.
 */
export function runVanillaSweep(args: RunSweepArgs): SweepHandle | null {
  const { state, controller, curtain, defaults, instantFallback, commit, options } = args;
  const merged: SweepOptions = { ...defaults, ...options };
  if (instantFallback || !controller) {
    void commit(new AbortController().signal);
    return null;
  }
  interruptActive(state);
  if (!curtain) {
    const handle = playSweep(controller, {
      ...merged,
      onMidpoint: async () => {
        await merged.onMidpoint?.();
        await commit(new AbortController().signal);
      },
    }) as ActiveHandle;
    trackHandle(state, handle);
    return handle;
  }
  const handle = playCoveredSweep(
    controller,
    curtain,
    async (signal) => {
      await merged.onMidpoint?.();
      await commit(signal);
    },
    merged,
  ) as ActiveHandle;
  trackHandle(state, handle);
  return handle;
}

/**
 * Sweep callback for interceptLinks. Runs the navigation through the shared
 * runner and always returns a SweepHandle (no-op on instant fallback).
 */
export function sweepForIntercept(
  state: RunnerState,
  controller: ShaderController | null,
  curtain: Curtain | null,
  defaults: SweepOptions,
  instantFallback: boolean,
) {
  return (nav: () => void | Promise<void>, options?: SweepOptions): SweepHandle => {
    const handle = runVanillaSweep({
      state,
      controller,
      curtain,
      defaults,
      instantFallback,
      commit: () => nav(),
      options,
    });
    return handle ?? noopSweepHandle();
  };
}

export type CurtainHost = {
  host: HTMLDivElement;
  curtain: Curtain;
  restore: () => void;
};

export function ensureHost(
  canvas: HTMLCanvasElement,
  controller: ShaderController | null,
): CurtainHost | null {
  if (!controller) return null;
  return ensureCurtainHost(canvas);
}
