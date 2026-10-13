// React adapter — works with ANY React router (Next, TanStack Start/Router,
// Remix, Astro islands). Re-exports the provider and adds framework-neutral
// helpers so per-framework entries stay thin.

import { useEffect } from "react";
import { GlimmProvider, useGlimm } from "glimm/react";
import type { SweepFn, SweepHandle, SweepOptions } from "glimm/react";
import { interceptLinks } from "./intercept.js";
import type { InterceptLinksOptions, NavigateFn } from "./intercept.js";

export { GlimmProvider, useGlimm };
export type { SweepFn, SweepHandle, SweepOptions };
export { interceptLinks };
export type { InterceptLinksOptions, NavigateFn };

export { PALETTES, EASINGS } from "glimm/react";
export type { Palette, PaletteName, Direction, EasingName, GlimmDefaults } from "glimm/react";

/**
 * Generic hook variant of {@link interceptLinks}. Drop it once inside
 * `<GlimmProvider>` and pass whatever navigate function your router uses.
 *
 * ```tsx
 * // TanStack Router
 * const router = useRouter()
 * useInterceptLinks((href) => router.history.push(href))
 *
 * // Next.js
 * const router = useRouter() // from next/navigation
 * useInterceptLinks((href) => router.push(href))
 *
 * // Remix / React Router
 * const navigate = useNavigate()
 * useInterceptLinks((href) => navigate(href))
 * ```
 *
 * Opt individual links out with `data-glimm-skip`.
 */
export function useInterceptLinks(navigate: NavigateFn, opts?: InterceptLinksOptions): void {
  const { sweep } = useGlimm();
  useEffect(() => {
    return interceptLinks(sweep, navigate, opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep, navigate, opts?.sweep, opts?.shouldIntercept]);
}
