// Vue / Nuxt adapter for glimm.
//
// Same shape as the Svelte entry: vanilla core owns the canvas, this file is
// the thin shell that runs clicks through a covered sweep (cover → hold
// until vue-router has committed + painted → reveal over the NEW page) and
// calls `router.push` (vue-router) at the hold. The router is passed in —
// never imported — so this entry works with vue-router and Nuxt alike.

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

/** Minimal surface of vue-router's router used here. */
export type VueRouterLike = {
  push: (href: string) => void | Promise<void>;
  replace?: (href: string) => void | Promise<void>;
  back?: () => void | Promise<void>;
};

export type VueSweepSetup = VanillaBaseSetup & {
  router: VueRouterLike;
};

export type VueSweepApi = {
  push: (href: string, options?: SweepOptions) => SweepHandle | null;
  replace: (href: string, options?: SweepOptions) => SweepHandle | null;
  destroy: () => void;
  controller: ShaderController | null;
};

/**
 * Wire glimm into a Vue app. Call once on mount (client-only):
 *
 * ```ts
 * // App.vue
 * import { useRouter } from 'vue-router'
 * import { setupGlimmVue } from 'better-glimm/vue'
 *
 * const router = useRouter()
 * onMounted(() => {
 *   const glimm = setupGlimmVue({ canvas: canvasEl.value!, router })
 *   onUnmounted(() => glimm.destroy())
 * })
 * ```
 */
export function setupGlimmVue({
  canvas,
  router,
  defaults = {},
  intercept = {},
  reducedMotion = "instant",
  onController,
}: VueSweepSetup): VueSweepApi {
  if (typeof window === "undefined" || typeof document === "undefined") {
    const nil = () => null;
    return { push: nil, replace: nil, destroy: () => {}, controller: null };
  }
  const instantFallback = resolveInstantFallback(reducedMotion);
  const controller = createVanillaController(canvas, defaults, onController);
  const hosted = ensureHost(canvas, controller);
  const state = createRunnerState();

  const run = (
    go: (signal: AbortSignal) => void | Promise<void>,
    options?: SweepOptions,
  ): SweepHandle | null =>
    runVanillaSweep({
      state,
      controller,
      curtain: hosted?.curtain ?? null,
      defaults,
      instantFallback,
      commit: go,
      options,
    });

  const cleanup = interceptLinks(
    sweepForIntercept(state, controller, hosted?.curtain ?? null, defaults, instantFallback),
    (href) => router.push(href),
    intercept,
  );

  return {
    push: (href, options) => run(() => router.push(href), options),
    replace: (href, options) =>
      run(() => (router.replace ? router.replace(href) : router.push(href)), options),
    destroy: () => {
      cleanup();
      interruptActive(state);
      hosted?.restore();
    },
    controller,
  };
}
