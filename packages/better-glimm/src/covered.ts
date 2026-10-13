// Covered sweep — vanilla port of glimm core's `playCoveredSweep`.
//
// Why this exists: a naked `playSweep(ctrl, { onMidpoint: navigate })`
// cannot hold the screen covered while the next page loads. At progress 1
// the band has already exited the viewport, so "holding" at progress 1
// shows the *old* page, and the outro then fades an already-exited band —
// the reveal over the new page is invisible. On MPA navigations
// (`location.assign`) the canvas is destroyed mid-sweep anyway.
//
// `playCoveredSweep` fixes the timing the way upstream does:
//   1. cover  — sweep 0 → 1 while the old page is visible (band wipes in),
//   2. hold   — opaque curtain covers the screen, WebGL hidden, `commit`
//              runs (router navigation / Astro swap), then we wait for the
//              commit AND two animation frames so the new page has painted,
//   3. reveal — sweep 0 → 1 again, now over the *new* page (band wipes out).
//
// The curtain is a plain absolutely-positioned div painted with the host's
// background color, so no View Transition API is required.

import { playSweep } from "glimm";
import type { Direction, ShaderController, SweepHandle, SweepOptions } from "glimm";

export type CommitFn = (signal: AbortSignal) => void | Promise<void>;

/** Covered sweep handle: SweepHandle plus curtain-preserving interrupt. */
export type CoveredSweepHandle = SweepHandle & {
  /** Cancel but keep the curtain so the next sweep continues from covered. */
  interrupt: () => void;
};

export type Curtain = {
  element: HTMLDivElement;
  begin: (direction: Direction) => number;
  update: (p: number, phase: "cover" | "reveal") => void;
  hold: () => void;
  hide: () => void;
  destroy: () => void;
};

function surfaceColor(host: HTMLElement): string {
  for (let node: HTMLElement | null = host.parentElement; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (!color || color === "transparent") continue;
    // Only rgba/hsla and slash syntax carry alpha. Plain rgb()/hsl() are
    // always opaque, so never treat their last channel as alpha.
    const hasAlphaSyntax =
      color.startsWith("rgba(") || color.startsWith("hsla(") || color.includes("/");
    if (hasAlphaSyntax) {
      const m = color.match(/(?:,|\/)\s*([\d.]+%?)\s*\)$/);
      const alphaStr = m?.[1];
      if (alphaStr) {
        const value = Number.parseFloat(alphaStr);
        const opaque = alphaStr.endsWith("%") ? 100 : 1;
        if (value < opaque) continue;
      }
    }
    return color;
  }
  return getComputedStyle(document.documentElement).colorScheme === "dark" ? "#111" : "#fff";
}

/** Creates the opaque hold-curtain. Caller must position `host` (relative/fixed). */
export function createCurtain(host: HTMLElement): Curtain {
  const element = document.createElement("div");
  element.dataset.glimmCurtain = "idle";
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "absolute",
    inset: "0",
    display: "none",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  host.prepend(element);
  let direction: Direction = "ltr";
  let progress = 0;
  let phase: "idle" | "cover" | "hold" | "reveal" = "idle";

  const update = (p: number, nextPhase: "cover" | "reveal") => {
    progress = p;
    phase = nextPhase;
    element.dataset.glimmCurtain = phase;
    const edge = (-0.2 + 1.4 * p) * 100;
    const axis =
      ({ ltr: "right", rtl: "left", ttb: "bottom", btt: "top" } as const)[direction] ?? "right";
    const before = nextPhase === "cover" ? "#000" : "transparent";
    const after = nextPhase === "cover" ? "transparent" : "#000";
    const mask = `linear-gradient(to ${axis}, ${before} ${edge - 3}%, ${after} ${edge + 3}%)`;
    element.style.maskImage = mask;
    (element.style as CSSStyleDeclaration & { webkitMaskImage: string }).webkitMaskImage = mask;
  };

  const hide = () => {
    phase = "idle";
    progress = 0;
    element.dataset.glimmCurtain = phase;
    element.style.display = "none";
  };

  return {
    element,
    begin(nextDirection: Direction) {
      const start = phase === "cover" && direction === nextDirection ? progress : 0;
      const wasCovered = phase === "hold" || phase === "reveal";
      direction = nextDirection;
      element.style.background = surfaceColor(host);
      element.style.display = "block";
      update(wasCovered ? 1 : start, "cover");
      return wasCovered ? 1 : start;
    },
    update,
    hold() {
      phase = "hold";
      progress = 1;
      element.dataset.glimmCurtain = phase;
      element.style.maskImage = "none";
      (element.style as CSSStyleDeclaration & { webkitMaskImage: string }).webkitMaskImage = "none";
    },
    hide,
    destroy() {
      element.remove();
    },
  };
}

/** Two rAFs — the new page has painted underneath when this resolves. */
export function nextPaint(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(finish);
    });
  });
}

function waitForWork(work: void | Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", finish);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) {
      // If work already failed synchronously, surface that error instead
      // of silently resolving on abort.
      void Promise.resolve(work).then(
        () => finish(),
        (error: unknown) => fail(error),
      );
      return;
    }
    void Promise.resolve(work).then(finish, (error: unknown) => fail(error));
  });
}

/**
 * Moves `canvas` into a fixed overlay host that also owns the curtain,
 * mirroring glimm/react's provider host (canvas + curtain stacked).
 * Returns the curtain; destroy the curtain and host via the cleanup.
 */
export function ensureCurtainHost(canvas: HTMLCanvasElement): {
  host: HTMLDivElement;
  curtain: Curtain;
  restore: () => void;
} {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.glimmHost = "";
  const canvasZ = Number.parseInt(getComputedStyle(canvas).zIndex, 10);
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: String(Number.isFinite(canvasZ) ? canvasZ : 9999),
  } satisfies Partial<CSSStyleDeclaration>);
  const parent = canvas.parentElement;
  const next = canvas.nextSibling;
  if (parent) parent.insertBefore(host, canvas);
  else document.body.appendChild(host);
  const prevPosition = canvas.style.position;
  const prevInset = canvas.style.inset;
  const prevWidth = canvas.style.width;
  const prevHeight = canvas.style.height;
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
  } satisfies Partial<CSSStyleDeclaration>);
  host.appendChild(canvas);
  const curtain = createCurtain(host);
  let restored = false;
  return {
    host,
    curtain,
    restore: () => {
      if (restored) return;
      restored = true;
      curtain.destroy();
      if (canvas.parentElement === host && parent) parent.insertBefore(canvas, next);
      else if (canvas.parentElement === host) document.body.appendChild(canvas);
      canvas.style.position = prevPosition;
      canvas.style.inset = prevInset;
      canvas.style.width = prevWidth;
      canvas.style.height = prevHeight;
      host.remove();
    },
  };
}

/**
 * Cover → hold-until-`commit`-plus-paint → reveal, mirroring upstream.
 * `commit` performs the route change (router.push / Astro navigate).
 * The returned handle resolves `midpoint` only after the new page is
 * committed and painted — that is the "run just after the next page is
 * loaded" timing.
 */
export function playCoveredSweep(
  ctrl: ShaderController,
  curtain: Curtain,
  commit: CommitFn,
  opts: SweepOptions = {},
): CoveredSweepHandle {
  const abort = new AbortController();
  let active: SweepHandle | undefined;
  let cancelled = false;
  let resolveMidpoint!: () => void;
  let resolveDone!: () => void;
  const midpoint = new Promise<void>((resolve) => {
    resolveMidpoint = resolve;
  });
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const duration = Number.isFinite(opts.sweepMs) ? Math.max(0, opts.sweepMs as number) : 1100;
  const split = Number.isFinite(opts.midpoint)
    ? Math.max(0.1, Math.min(0.9, opts.midpoint as number))
    : 0.56;
  const start = curtain.begin(opts.direction ?? "ltr");
  let locked = false;

  const cancel = (preserve: boolean) => {
    cancelled = true;
    abort.abort();
    active?.cancel();
    if (!preserve) {
      curtain.hide();
      ctrl.setAlpha(0);
      ctrl.setProgress(0);
    }
    resolveMidpoint();
    resolveDone();
  };

  void (async () => {
    const coverCtrl: ShaderController = {
      ...ctrl,
      getProgress: () => 0,
      setProgress: (p: number) => {
        if (!locked) {
          curtain.update(start + (1 - start) * p, "cover");
          ctrl.setProgress(start + (1 - start) * p);
        }
      },
    };
    active = playSweep(coverCtrl, {
      ...opts,
      sweepMs: start >= 1 ? 0 : duration * split,
      outroMs: 0,
      midpoint: 1,
      onComplete: undefined,
      onMidpoint: async () => {
        locked = true;
        curtain.hold();
        ctrl.setAlpha(0);
        await nextPaint(abort.signal);
        if (cancelled) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            waitForWork(commit(abort.signal), abort.signal),
            new Promise<void>((resolve) => {
              timer = setTimeout(() => {
                console.warn("[better-glimm] content commit timed out; releasing the curtain");
                abort.abort();
                resolve();
              }, 8000);
            }),
          ]);
        } catch (error) {
          console.error("[better-glimm] content commit failed:", error);
        } finally {
          clearTimeout(timer);
        }
        if (!cancelled) await nextPaint(abort.signal);
        resolveMidpoint();
      },
    });
    await active.done;
    if (cancelled) return;
    const revealCtrl: ShaderController = {
      ...ctrl,
      getProgress: () => 0,
      setProgress: (p: number) => {
        curtain.update(p, "reveal");
        ctrl.setProgress(p);
      },
    };
    active = playSweep(revealCtrl, {
      ...opts,
      sweepMs: duration * (1 - split),
      midpoint: 1,
      onMidpoint: () => curtain.hide(),
      onComplete: undefined,
    });
    await active.done;
    if (!cancelled) {
      curtain.hide();
      opts.onComplete?.();
    }
  })()
    .catch((error: unknown) => {
      console.error("[better-glimm] covered sweep failed:", error);
      if (!cancelled) {
        curtain.hide();
        ctrl.setAlpha(0);
      }
    })
    .finally(() => {
      resolveMidpoint();
      resolveDone();
    });

  return {
    midpoint,
    done,
    cancel: () => cancel(false),
    interrupt: () => cancel(true),
  };
}
