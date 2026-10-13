// SvelteKit adapter for glimm.
//
// SvelteKit has no `<GlimmProvider>` — the vanilla core owns the canvas and
// the sweep state machine. This entry provides the thin shell: run every
// same-origin click through a covered sweep (cover → hold until SvelteKit
// has committed + painted → reveal over the NEW page) and call SvelteKit's
// `goto` at the hold.
//
// No static import of `$app/navigation` here so this entry stays importable
// outside SvelteKit (and SSR-safe: all helpers no-op without `window`).

import type { Palette, PaletteName, ShaderController, SweepHandle, SweepOptions } from "glimm";
import { interceptLinks, defaultShouldIntercept } from "./intercept.js";
import type { InterceptLinksOptions } from "./intercept.js";
import {
  createRunnerState,
  createVanillaController,
  ensureHost,
  interruptActive,
  resolveInstantFallback,
  runVanillaSweep,
  sweepForIntercept,
} from "./vanilla.js";
import type { VanillaBaseSetup } from "./vanilla.js";

export { defaultShouldIntercept, interceptLinks };
export { createShader, playSweep } from "glimm";
export type { Palette, PaletteName, ShaderController, SweepOptions, InterceptLinksOptions };

/** SvelteKit's `goto` — passed in by the caller, never imported here. */
export type SvelteGoto = (href: string) => void | Promise<void>;

export type SvelteSweepSetup = VanillaBaseSetup & {
  /** SvelteKit `goto` from `$app/navigation`. */
  goto: SvelteGoto;
};

export type SvelteSweepApi = {
  /** Sweep-animated navigation. Null when reduced-motion/WebGL fallback. */
  navigate: (href: string, options?: SweepOptions) => SweepHandle | null;
  /** Remove the delegated click listener. */
  destroy: () => void;
  /** The underlying shader controller (null when WebGL unavailable/SSR). */
  controller: ShaderController | null;
};

/**
 * Wire glimm into a SvelteKit app. Call once in `onMount` (client-only):
 *
 * ```svelte
 * <script lang="ts">
 *   import { onMount } from 'svelte'
 *   import { goto } from '$app/navigation'
 *   import { setupGlimm } from 'better-glimm/svelte'
 *
 *   let canvas: HTMLCanvasElement
 *   let glimm: ReturnType<typeof setupGlimm>
 *   onMount(() => {
 *     glimm = setupGlimm({ canvas, goto, defaults: { palette: 'prism' } })
 *     return () => glimm?.destroy()
 *   })
 * </script>
 *
 * <canvas bind:this={canvas} class="glimm-canvas" />
 * ```
 *
 * Per-link overrides: call `glimm.navigate(href, { palette: 'berry' })`
 * directly. Opt links out with `data-glimm-skip`.
 */
export function setupGlimm({
  canvas,
  goto,
  defaults = {},
  intercept = {},
  reducedMotion = "instant",
  onController,
}: SvelteSweepSetup): SvelteSweepApi {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { navigate: () => null, destroy: () => {}, controller: null };
  }
  const instantFallback = resolveInstantFallback(reducedMotion);
  const controller = createVanillaController(canvas, defaults, onController);
  const hosted = ensureHost(canvas, controller);
  const state = createRunnerState();

  const run = (
    commit: (signal: AbortSignal) => void | Promise<void>,
    options?: SweepOptions,
  ): SweepHandle | null =>
    runVanillaSweep({
      state,
      controller,
      curtain: hosted?.curtain ?? null,
      defaults,
      instantFallback,
      commit,
      options,
    });

  const navigate = (href: string, options?: SweepOptions) => run(() => goto(href), options);

  const cleanup = interceptLinks(
    sweepForIntercept(state, controller, hosted?.curtain ?? null, defaults, instantFallback),
    (href) => goto(href),
    intercept,
  );

  return {
    navigate,
    destroy: () => {
      cleanup();
      interruptActive(state);
      hosted?.restore();
    },
    controller,
  };
}
