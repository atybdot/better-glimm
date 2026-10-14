import { describe, expect, it, vi } from "vitest";
import { defaultShouldIntercept, interceptLinks } from "../src/intercept.js";

function click(anchor: HTMLAnchorElement, init?: MouseEventInit) {
  return new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
}

describe("defaultShouldIntercept", () => {
  it("intercepts plain internal links", () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const a = document.querySelector("a")!;
    expect(defaultShouldIntercept(click(a), a)).toBe(true);
  });

  it("skips data-glimm-skip", () => {
    document.body.innerHTML = `<a href="/about" data-glimm-skip>About</a>`;
    const a = document.querySelector("a")!;
    expect(defaultShouldIntercept(click(a), a)).toBe(false);
  });

  it("skips target=_blank, download, external, same-page hash, modifiers", () => {
    document.body.innerHTML = `
      <a id="t" href="/a" target="_blank">t</a>
      <a id="d" href="/a" download>d</a>
      <a id="e" href="https://example.com/a">e</a>
      <a id="m" href="/a">m</a>`;
    const q = (id: string) => document.querySelector<HTMLAnchorElement>(id)!;
    expect(defaultShouldIntercept(click(q("#t")), q("#t"))).toBe(false);
    expect(defaultShouldIntercept(click(q("#d")), q("#d"))).toBe(false);
    expect(defaultShouldIntercept(click(q("#e")), q("#e"))).toBe(false);
    expect(defaultShouldIntercept(click(q("#m"), { metaKey: true }), q("#m"))).toBe(false);
  });

  it("skips same-page anchors", () => {
    const here = window.location.pathname + window.location.search;
    document.body.innerHTML = `<a href="${here}#section">s</a>`;
    const a = document.querySelector("a")!;
    expect(defaultShouldIntercept(click(a), a)).toBe(false);
  });
});

describe("interceptLinks", () => {
  it("sweeps internal clicks and cleans up", () => {
    document.body.innerHTML = `<a href="/about">About</a><a href="/skip" data-glimm-skip>Skip</a>`;
    const sweep = vi.fn<
      (nav: () => void) => { midpoint: Promise<void>; done: Promise<void>; cancel: () => void }
    >((_nav) => ({
      midpoint: Promise.resolve(),
      done: Promise.resolve(),
      cancel: () => {},
    }));
    const navigate = vi.fn<(href: string) => void>();
    const cleanup = interceptLinks(sweep as never, navigate);

    const anchors = Array.from(document.querySelectorAll("a"));
    anchors[0]!.dispatchEvent(click(anchors[0]!));
    expect(sweep).toHaveBeenCalledTimes(1);
    // Run the captured navigate callback through the sweep midpoint.
    const nav = sweep.mock.calls[0]![0] as () => void;
    nav();
    expect(navigate).toHaveBeenCalledWith("/about");

    anchors[1]!.dispatchEvent(click(anchors[1]!));
    expect(sweep).toHaveBeenCalledTimes(1);

    cleanup();
    anchors[0]!.dispatchEvent(click(anchors[0]!));
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("applies per-interceptor sweep overrides", () => {
    document.body.innerHTML = `<a href="/x">X</a>`;
    const sweep = vi.fn<
      (...args: unknown[]) => { midpoint: Promise<void>; done: Promise<void>; cancel: () => void }
    >((..._args) => ({
      midpoint: Promise.resolve(),
      done: Promise.resolve(),
      cancel: () => {},
    }));
    const cleanupOverrides = interceptLinks(sweep as never, () => {}, {
      sweep: { palette: "berry" },
    });
    document.querySelector("a")!.dispatchEvent(click(document.querySelector("a")!));
    expect(sweep.mock.calls[0]?.[1]).toMatchObject({ palette: "berry" });
    cleanupOverrides();
  });

  it("falls back to navigate when sweep throws", () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const sweep = vi.fn<() => void>(() => {
      throw new Error("webgl lost");
    });
    const navigate = vi.fn<(href: string) => void>();
    const cleanup = interceptLinks(sweep as never, navigate);
    document.querySelector("a")!.dispatchEvent(click(document.querySelector("a")!));
    expect(navigate).toHaveBeenCalledWith("/about");
    cleanup();
  });
});
