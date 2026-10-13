// Astro adapter for glimm.
//
// Timing (the fix): a naked `playSweep(ctrl, { onMidpoint: navigate })`
// cannot hold the screen covered while the next page loads — at progress 1
// the band has already exited, so the hold shows the old page and the
// outro fades an exited band. This entry uses `playCoveredSweep` instead:
// cover → opaque curtain hold while Astro swaps → reveal over the NEW
// page. `midpoint` resolves only after the swap has painted.
//
// Requires Astro View Transitions (`<ClientRouter />` in the layout) and
// `navigate` from `astro:transitions/client` so the swap happens without
// destroying the canvas. The canvas must survive swaps: give it
// `transition:persist`. Without `navigate` this falls back to a plain
// location change (cover, then cut — no reveal possible across reload).

import type { Palette, PaletteName, ShaderController, SweepHandle, SweepOptions } from "glimm";
import { interceptLinks, defaultShouldIntercept } from "./intercept.js";
import type { InterceptLinksOptions } from "./intercept.js";
import { nextPaint } from "./covered.js";
import type { Curtain } from "./covered.js";
import {
  createRunnerState,
  createVanillaController,
  interruptActive,
  resolveInstantFallback,
  runVanillaSweep,
} from "./vanilla.js";
import type { RunnerState, VanillaBaseSetup } from "./vanilla.js";
import { ensureCurtainHost } from "./covered.js";

export { defaultShouldIntercept, interceptLinks };
export { createShader, playSweep } from "glimm";
export type { Palette, PaletteName, ShaderController, SweepOptions, InterceptLinksOptions };

/** Astro's `navigate` from `astro:transitions/client` — passed in by caller. */
export type AstroNavigate = (href: string) => void | Promise<void>;

export type AstroSweepSetup = VanillaBaseSetup & {
  /** From `astro:transitions/client`. Defaults to a location change (no reveal). */
  navigate?: AstroNavigate;
};

export type AstroSweepApi = {
  navigate: (href: string, options?: SweepOptions) => SweepHandle | null;
  /**
   * Run a covered sweep around any commit, not just navigation. The commit
   * runs at hold, so the reveal plays over the changed page — theme swaps,
   * filters, layout changes. Falls back to running the commit at once when
   * reduced motion is on or WebGL is missing.
   */
  sweep: (
    commit: (signal: AbortSignal) => void | Promise<void>,
    options?: SweepOptions,
  ) => SweepHandle | null;
  destroy: () => void;
  controller: ShaderController | null;
};

type CanvasSlot = {
  api: AstroSweepApi;
  rehost: () => void;
  /** JSON key of setup that built this slot. Changed config rebuilds it. */
  setupKey: string;
  state: RunnerState;
};

/** Resolves after Astro fires `astro:after-swap` (or after `timeoutMs`). */
function afterSwap(timeoutMs = 3000): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const onSwap = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("astro:after-swap", onSwap);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      document.removeEventListener("astro:after-swap", onSwap);
      resolve();
    }, timeoutMs);
    document.addEventListener("astro:after-swap", onSwap, { once: true });
  });
}

/**
 * Wire glimm into an Astro layout (client-only):
 *
 * ```astro
 * ---
 * import { ClientRouter } from 'astro:transitions'
 * ---
 * <head><ClientRouter /></head>
 * <canvas id="glimm" transition:persist />
 * <script>
 *   import { navigate } from 'astro:transitions/client'
 *   import { setupGlimmAstro } from 'better-glimm/astro'
 *   const canvas = document.querySelector('[data-astro-canvas]')
 *   setupGlimmAstro({ canvas, navigate })
 * </script>
 * ```
 *
 * The delegated click interceptor runs before Astro's own router. Opt
 * links out with `data-glimm-skip`.
 */
export function setupGlimmAstro({
  canvas,
  navigate,
  defaults = {},
  intercept = {},
  reducedMotion = "instant",
  onController,
}: AstroSweepSetup): AstroSweepApi {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { navigate: () => null, sweep: () => null, destroy: () => {}, controller: null };
  }
  // Layout scripts re-execute after every Astro swap. The persisted canvas
  // (transition:persist) keeps its setup — dedupe so we never double-bind
  // the click interceptor or double-host the canvas. If setup config
  // changed, tear down the old slot and rebuild.
  type CanvasWithSlot = HTMLCanvasElement & { __glimmAstro?: CanvasSlot };
  const keyed = canvas as CanvasWithSlot;
  const setupKey = JSON.stringify({ defaults, reducedMotion, hasNavigate: !!navigate });
  const existing = keyed.__glimmAstro;
  if (existing && canvas.isConnected) {
    if (existing.setupKey === setupKey) {
      existing.rehost();
      return existing.api;
    }
    existing.api.destroy();
  }
  const spa = typeof navigate === "function";
  const go: AstroNavigate = navigate ?? ((href) => void window.location.assign(href));
  const instantFallback = resolveInstantFallback(reducedMotion);

  const controller = createVanillaController(canvas, defaults, onController);
  const state = createRunnerState();

  // Curtain host: fixed overlay holding the WebGL canvas + opaque curtain
  // together, mirroring glimm/react's provider host. The canvas keeps its
  // WebGL context across Astro swaps (it also needs `transition:persist`
  // to survive the swap itself).
  let curtain: Curtain | null = null;
  let restoreCanvas: (() => void) | null = null;
  const hostCanvas = () => {
    if (!controller || typeof document === "undefined") return;
    if (canvas.parentElement?.hasAttribute("data-glimm-host")) return;
    restoreCanvas?.();
    const hosted = ensureCurtainHost(canvas);
    curtain = hosted.curtain;
    restoreCanvas = hosted.restore;
  };
  hostCanvas();
  // Astro removes the runtime host on swap (only the canvas itself is
  // persisted). Rebuild the host around the surviving canvas.
  const onSwap = () => hostCanvas();
  document.addEventListener("astro:after-swap", onSwap);

  const commitSpa = (href: string) => async (signal: AbortSignal) => {
    if (signal.aborted) return;
    // Listen before navigating: navigate() may resolve after the event.
    const swapped = afterSwap();
    await go(href);
    if (!signal.aborted) await Promise.race([swapped, nextPaint(signal)]);
  };

  const run = (commit: (signal: AbortSignal) => void | Promise<void>, options?: SweepOptions) => {
    // MPA fallback (no Astro navigate): no curtain hold is possible across
    // a reload — cover, swap at midpoint, cut. SPA path holds the curtain
    // until the new page has painted, then reveals over it.
    if (!spa || !curtain) {
      return runVanillaSweep({
        state,
        controller,
        curtain: null,
        defaults,
        instantFallback,
        commit,
        options,
      });
    }
    return runVanillaSweep({
      state,
      controller,
      curtain,
      defaults,
      instantFallback,
      commit,
      options,
    });
  };

  const navigateSweep = (href: string, options?: SweepOptions) =>
    run(spa ? commitSpa(href) : () => go(href), options);

  const sweep = (
    commit: (signal: AbortSignal) => void | Promise<void>,
    options?: SweepOptions,
  ): SweepHandle | null =>
    runVanillaSweep({
      state,
      controller,
      curtain,
      defaults,
      instantFallback,
      commit,
      options,
    });

  const rawNavigate = (href: string) => {
    if (spa) void commitSpa(href)(new AbortController().signal);
    else void go(href);
  };

  const getCurtain = () => curtain;
  const noopHandle = () =>
    ({ midpoint: Promise.resolve(), done: Promise.resolve(), cancel: () => {} }) as SweepHandle;
  const cleanup = interceptLinks(
    (nav, options) =>
      runVanillaSweep({
        state,
        controller,
        curtain: getCurtain(),
        defaults,
        instantFallback,
        commit: () => nav(),
        options,
      }) ?? noopHandle(),
    rawNavigate,
    intercept,
  );

  const api: AstroSweepApi = {
    navigate: navigateSweep,
    sweep,
    destroy: () => {
      cleanup();
      interruptActive(state);
      document.removeEventListener("astro:after-swap", onSwap);
      restoreCanvas?.();
      if (keyed.__glimmAstro?.api === api) delete keyed.__glimmAstro;
    },
    controller,
  };
  keyed.__glimmAstro = {
    api,
    rehost: hostCanvas,
    setupKey,
    state,
  };
  return api;
}
