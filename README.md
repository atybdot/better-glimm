# better-glimm

WebGL sweep page transitions for TanStack Router, SvelteKit, Vue Router, Nuxt, Astro, and any React router.

[glimm](https://glimm.dev) does all the rendering. Shaders, palettes, easings and the sweep itself come from glimm unchanged. better-glimm adds the router wiring glimm doesn't ship, and re-exports the glimm core and React provider. Every glimm option works the same here, so the [glimm docs](https://glimm.dev#props) apply as written.

## Why this exists

glimm ships a vanilla core, a React provider that works with any React router, and helpers for Next.js. If you use TanStack Router, SvelteKit, Vue Router, Nuxt or Astro, there is no official adapter. better-glimm is one small adapter per router. It doesn't fork the engine or duplicate any shader code.

## Install

```bash
npm install better-glimm
```

glimm comes with it. Don't install it separately. Then install the peer your app already uses, if you haven't. The package is ESM-only, and each router has its own import path.

| Router                 | Import                  | Main exports                                              |
| ---------------------- | ----------------------- | --------------------------------------------------------- |
| TanStack Router        | `better-glimm/tanstack` | `TransitionLink`, `useTransitionRouter`, `InterceptLinks` |
| Any other React router | `better-glimm/react`    | `GlimmProvider`, `useInterceptLinks`                      |
| SvelteKit              | `better-glimm/svelte`   | `setupGlimm`                                              |
| Vue Router, Nuxt       | `better-glimm/vue`      | `setupGlimmVue`                                           |
| Astro                  | `better-glimm/astro`    | `setupGlimmAstro`                                         |
| No router, vanilla JS  | `better-glimm`          | glimm core, `interceptLinks`, `playCoveredSweep`          |

## Use

### TanStack Router

```tsx
import { GlimmProvider, InterceptLinks } from "better-glimm/tanstack";

export function Root() {
  return (
    <GlimmProvider palette="prism">
      <InterceptLinks />
      <Outlet />
    </GlimmProvider>
  );
}
```

`InterceptLinks` sweeps every plain `<a>` on the page. For a single link or a programmatic navigation, use the link component and the hook.

```tsx
import { TransitionLink, useTransitionRouter } from "better-glimm/tanstack";

<TransitionLink to="/about" sweep={{ palette: "berry" }}>
  About
</TransitionLink>;

const router = useTransitionRouter();
router.push("/dashboard", { palette: "ember" });
```

`useTransitionRouter` also returns `replace`, `back` and `forward`. Add `noTransition` to a `TransitionLink` to skip the sweep for that link.

### Other React routers

Pass your router's navigate function. The hook wraps it.

```tsx
import { GlimmProvider, useInterceptLinks } from "better-glimm/react";
import { useNavigate } from "react-router-dom";

function AutoLinks() {
  const navigate = useNavigate();
  useInterceptLinks((href) => navigate(href));
  return null;
}
```

Render `AutoLinks` inside `GlimmProvider`, which must sit inside your router.

### SvelteKit

Pass `goto` yourself. The package never imports `$app/navigation`.

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { setupGlimm } from "better-glimm/svelte";

  let canvas: HTMLCanvasElement;
  onMount(() => {
    const glimm = setupGlimm({ canvas, goto });
    return () => glimm.destroy();
  });
</script>

<canvas bind:this={canvas} />
```

`setupGlimm` returns `{ navigate, destroy, controller }`. Call `navigate(href, overrides)` for a programmatic sweep.

### Vue and Nuxt

```ts
import { setupGlimmVue } from "better-glimm/vue";

const glimm = setupGlimmVue({ canvas: canvasEl.value!, router });
onUnmounted(() => glimm.destroy());
```

The router only needs `push`, and optionally `replace` and `back`, so vue-router and Nuxt's router both fit. The return value has `push`, `replace`, `destroy` and `controller`.

### Astro

Astro needs View Transitions, so add `<ClientRouter />` to your layout. Put `transition:persist` on the canvas so the WebGL context survives page swaps.

```astro
<canvas id="glimm" transition:persist />
<script>
  import { navigate } from "astro:transitions/client";
  import { setupGlimmAstro } from "better-glimm/astro";
  const canvas = document.querySelector("#glimm") as HTMLCanvasElement;
  setupGlimmAstro({ canvas, navigate });
</script>
```

Layout scripts re-run on every swap. The adapter guards against double setup, so you don't need to. If you leave out `navigate`, it falls back to a full page load. You get the cover half of the sweep, then a hard cut with no reveal.

## How it works

Each adapter listens for same-origin link clicks, plays a sweep, and navigates while the screen is covered. The sweep runs in two halves with a curtain in between.

1. **Cover.** The band sweeps across the old page.
2. **Hold.** A solid curtain, filled with the page's background color, takes over and the WebGL layer goes transparent. The router commits the new route. The adapter waits for the commit and two animation frames, so the new page is painted before anything is revealed.
3. **Reveal.** The band sweeps across the new page, and the curtain drops at the midpoint.

glimm's own `playSweep` can't do this alone. Its band has fully left the screen by progress 1, so holding there shows the old page, and the fade-out plays over a band that is already gone. The curtain fills that gap. It lives in `covered.ts` and is exported as `playCoveredSweep`.

If a route takes longer than 8 seconds to commit, the adapter logs a warning and drops the curtain. If the commit throws, it logs the error and drops the curtain. A second click during a sweep interrupts the first.

## Links that skip the sweep

These navigate immediately.

- Clicks with a modifier key, and any non-left button
- External URLs and links with `target` other than `_self`
- Same-page hash links
- Links with a `download` attribute or no `href`
- Anything marked `data-glimm-skip`
- Events another handler already called `preventDefault()` on

To change the rules, pass `shouldIntercept` in the intercept options. It replaces the default check.

## Fallbacks

- **No WebGL.** `createShader` returns `null` and navigation runs at once.
- **Server rendering.** Every entry point does nothing without `window` and `document`.
- **Reduced motion.** With `prefers-reduced-motion: reduce`, navigation is instant. Pass `reducedMotion: "sweep"` to play the sweep anyway.

## Options

These are glimm options. Set them as provider defaults, or override them for one navigation, as in `sweep={{ palette: "berry", direction: "rtl" }}`. Svelte, Vue and Astro take the same values through `defaults` and per-call options.

| Option       | Default | What it does                                                                                           |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| palette      | prism   | Band colors. `prism`, `berry`, `lagoon`, `citrus`, `azure`, `ember`, or a custom a b c d set           |
| direction    | ltr     | Sweep side. `ltr`, `rtl`, `ttb`, `btt`                                                                 |
| easing       | ease    | Band pacing. Ten built-ins including `linear`, `snap`, `back` and `easeOutQuart`, or your own function |
| sweepMs      | 1100    | Time for the band to cross                                                                             |
| outroMs      | 220     | Fade time after the crossing                                                                           |
| midpoint     | 0.56    | Point in the sweep where navigation runs. Clamped to 0.1 to 0.9                                        |
| peakAlpha    | 1       | Caps band opacity, 0 to 1.5                                                                            |
| brightness   | 1       | Scales band RGB. Try 0.85 on dark backgrounds                                                          |
| bandTight    | 14      | Band focus. Lower values give a wider, softer band                                                     |
| waveAmount   | 0       | Edge wobble, 0 to 2. At 0 the edge is straight                                                         |
| rippleAmount | 1       | Vertical ripple texture, 0 to 2                                                                        |
| waveSpeed    | 1       | Shader animation speed, 0 to 3                                                                         |

## Repo layout

```
packages/better-glimm/
  src/
    index.ts       glimm core re-export, interceptLinks, playCoveredSweep
    intercept.ts   delegated click interceptor
    covered.ts     cover, hold, reveal sweep and curtain
    react.tsx      GlimmProvider re-export, useInterceptLinks
    tanstack.tsx   TransitionLink, useTransitionRouter, InterceptLinks
    svelte.ts      setupGlimm
    vue.ts         setupGlimmVue
    astro.ts       setupGlimmAstro
  tests/
apps/web/          demo app
```

The package is built with tsup, one entry per file above. Router libraries are optional peer dependencies.

## Demo app

`apps/web` is the docs site. It runs Astro with Tailwind, React (compiler on), astro-themes dark mode, astro-seo, and a sitemap. Local dev goes through portless:

```bash
pnpm dev   # https://better-glimm.localhost
```

It deploys to Cloudflare Workers through `@astrojs/cloudflare`:

```bash
pnpm --filter web build
pnpm --filter web exec wrangler deploy
```

## Credit

The engine is [glimm](https://glimm.dev) by [Noman Ijaz](https://x.com/nomandsign), MIT.  
better-glimm is built against glimm 0.3.1. The adapters here are original.

## Release

Versioning uses changesets plus `release-*` tags.

```bash
pnpm changeset                  # note a change
pnpm publish:release -- patch   # checks, bump, changelog, tag, push, gh release
```

- Pre-commit: lefthook auto-fixes format/lint on staged files, fails on the rest.
- CI (`ci.yml`): format check, lint, typecheck, test, build on push/PR.
- Publish (`release.yml`): same checks plus `pnpm publish`, only on manual dispatch or a `release-*` tag. Needs `NPM_TOKEN`.
