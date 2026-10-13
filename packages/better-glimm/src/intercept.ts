import type { SweepHandle, SweepOptions } from "glimm";

/** Plays the band, awaits `navigate` at the midpoint. Mirrors `glimm/react`. */
export type SweepFn = (navigate: () => void | Promise<void>, options?: SweepOptions) => SweepHandle;

export type Href = string;

/** Callback that performs the actual route change. Awaited at sweep midpoint. */
export type NavigateFn = (href: string) => void | Promise<void>;

export type InterceptLinksOptions = {
  /**
   * Per-link override. Default selects every internal `<a href>` that's not
   * marked with `data-glimm-skip`, doesn't `target="_blank"`, isn't an
   * anchor or download, and isn't a modifier-click. You usually don't need
   * to customize this.
   */
  shouldIntercept?: (e: MouseEvent, anchor: HTMLAnchorElement) => boolean;
  /** Optional sweep overrides applied to every intercepted nav. */
  sweep?: SweepOptions;
};

/**
 * Default predicate mirroring `glimm/next` semantics.
 *
 * Skips: default-prevented events, modifier clicks, non-left buttons,
 * `data-glimm-skip`, `target` other than `_self`, `download` links,
 * missing/empty hrefs, cross-origin URLs, and same-page hashes.
 *
 * SSR-safe: returns false when `window` is undefined.
 */
export const defaultShouldIntercept = (e: MouseEvent, a: HTMLAnchorElement): boolean => {
  if (typeof window === "undefined") return false;
  if (e.defaultPrevented) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (e.button !== 0) return false;
  if (a.dataset.glimmSkip !== undefined) return false;
  if (a.target && a.target !== "_self") return false;
  if (a.hasAttribute("download")) return false;
  if (!a.href) return false;
  let url: URL;
  try {
    url = new URL(a.href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash
  )
    return false;
  return true;
};

/**
 * Vanilla, framework-agnostic: installs a delegated click listener on the
 * document that runs every same-origin link click through a sweep.
 * Returns a cleanup function that removes the listener.
 *
 * Pair with a navigate callback that performs the actual route change:
 *
 * ```ts
 * import { interceptLinks } from 'better-glimm'
 * const { sweep } = useGlimm()
 * useEffect(() => interceptLinks(sweep, (href) => router.push(href)), [sweep])
 * ```
 *
 * SSR-safe: no-ops (returns a no-op cleanup) when `document` is undefined.
 */
export function interceptLinks(
  sweep: SweepFn,
  navigate: NavigateFn,
  opts: InterceptLinksOptions = {},
): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }
  const shouldIntercept = opts.shouldIntercept ?? defaultShouldIntercept;
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (!shouldIntercept(e, anchor)) return;
    let href: string;
    try {
      const url = new URL(anchor.href, window.location.href);
      href = url.pathname + url.search + url.hash;
    } catch {
      return;
    }
    e.preventDefault();
    try {
      const handle = sweep(() => navigate(href), opts.sweep);
      // A null-ish return means instant fallback already navigated.
      void handle;
    } catch {
      // WebGL/context loss must never swallow the click.
      void navigate(href);
    }
  };
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
