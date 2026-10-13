// TanStack Router adapter for glimm — mirrors the `glimm/next` API
// (`TransitionLink`, `useTransitionRouter`, `InterceptLinks`) on top of
// `@tanstack/react-router`. Only this file knows about TanStack; the WebGL
// engine is reused as-is from `glimm` via `glimm/react`.

import { forwardRef, useEffect } from "react";
import { Link, useRouter, type LinkComponentProps } from "@tanstack/react-router";
import { useGlimm } from "glimm/react";
import type { SweepHandle, SweepOptions } from "glimm/react";
import { interceptLinks } from "./intercept.js";
import type { InterceptLinksOptions } from "./intercept.js";

export { GlimmProvider, useGlimm } from "glimm/react";
export { PALETTES, EASINGS } from "glimm/react";
export type {
  Palette,
  PaletteName,
  Direction,
  EasingName,
  GlimmDefaults,
  SweepFn,
  SweepHandle,
  SweepOptions,
} from "glimm/react";

export type TransitionLinkProps = LinkComponentProps<"a"> & {
  /** Per-link sweep overrides (palette, direction, duration…). */
  sweep?: SweepOptions;
  /** If true, skip the sweep and just navigate. Default false. */
  noTransition?: boolean;
};

/**
 * Drop-in replacement for TanStack Router's `<Link>` that plays a glimm
 * sweep around the navigation. Falls back to a normal link click for
 * modifier clicks, `target="_blank"`, external URLs, and same-page hashes.
 *
 * ```tsx
 * import { TransitionLink } from 'better-glimm/tanstack'
 * <TransitionLink to="/about" sweep={{ palette: 'berry', direction: 'rtl' }}>
 *   About
 * </TransitionLink>
 * ```
 *
 * Opt out per link with `noTransition` or globally per anchor with
 * `data-glimm-skip` (handled by `<InterceptLinks />`, not here).
 */
export const TransitionLink = forwardRef<HTMLAnchorElement, TransitionLinkProps>(
  function TransitionLink({ onClick, sweep: sweepOpts, noTransition, ...linkProps }, ref) {
    const router = useRouter();
    const { sweep } = useGlimm();

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (noTransition) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const anchor = e.currentTarget;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.dataset.glimmSkip !== undefined) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      )
        return;
      e.preventDefault();
      const { to, params, search, hash, replace } = linkProps as {
        to?: string;
        params?: Record<string, string>;
        search?: Record<string, unknown>;
        hash?: string;
        replace?: boolean;
      };
      const normalizedHash = hash ? hash.replace(/^#/, "") : undefined;
      try {
        if (to) {
          sweep(
            () =>
              router.navigate({
                to: to as string,
                params: params as never,
                search: search as never,
                hash: normalizedHash,
                replace,
              }),
            sweepOpts,
          );
        } else {
          // Fall back to the clicked href. Pass it as a single `to` so
          // search/hash are not supplied twice.
          sweep(
            () =>
              router.navigate({
                to: (url.pathname + url.search + url.hash) as string,
                replace,
              }),
            sweepOpts,
          );
        }
      } catch {
        // Sweep setup failed — fall back to plain navigation.
        if (to) {
          void router.navigate({
            to: to as string,
            params: params as never,
            search: search as never,
            hash: normalizedHash,
            replace,
          });
        } else {
          void router.navigate({ to: (url.pathname + url.search + url.hash) as string, replace });
        }
      }
    };

    return <Link ref={ref} {...linkProps} onClick={handleClick} />;
  },
);

export type TransitionRouter = {
  /** Push a new route, animated by a sweep. Returns the sweep handle. */
  push: (href: string, options?: SweepOptions) => SweepHandle;
  /** Replace the current route, animated by a sweep. */
  replace: (href: string, options?: SweepOptions) => SweepHandle;
  /** Navigate back, animated by a sweep. */
  back: (options?: SweepOptions) => SweepHandle;
  /** Navigate forward, animated by a sweep. */
  forward: (options?: SweepOptions) => SweepHandle;
};

/**
 * Drop-in programmatic navigation for TanStack Router that plays a glimm
 * sweep around each call. For declarative links prefer `<TransitionLink>`.
 *
 * ```tsx
 * const router = useTransitionRouter()
 * await save(form)
 * router.push('/dashboard', { palette: 'ember' })
 * ```
 */
export function useTransitionRouter(): TransitionRouter {
  const router = useRouter();
  const { sweep } = useGlimm();
  return {
    push: (href, options) => sweep(() => router.history.push(href), options),
    replace: (href, options) => sweep(() => router.history.replace(href), options),
    back: (options) => sweep(() => router.history.back(), options),
    forward: (options) => sweep(() => router.history.forward(), options),
  };
}

/**
 * React hook variant. Drop it once inside `<GlimmProvider>` (e.g. in the
 * root route) and every internal link click gets a sweep automatically.
 * Opt individual links out with `data-glimm-skip`.
 *
 * ```tsx
 * // __root.tsx
 * import { GlimmProvider } from 'better-glimm/tanstack'
 * import { InterceptLinks } from 'better-glimm/tanstack'
 * export function Root() {
 *   return (
 *     <GlimmProvider palette="prism">
 *       <InterceptLinks />
 *       <Outlet />
 *     </GlimmProvider>
 *   )
 * }
 * ```
 */
export function InterceptLinks(props: InterceptLinksOptions): null {
  const router = useRouter();
  const { sweep } = useGlimm();
  useEffect(() => {
    return interceptLinks(sweep, (href) => router.history.push(href), props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, sweep, props.sweep, props.shouldIntercept]);
  return null;
}
