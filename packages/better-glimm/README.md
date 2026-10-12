# better-glimm

WebGL sweep page transitions for any router. It runs on [glimm](https://glimm.dev) under the hood.

glimm owns the WebGL. Shaders, palettes, easings, the sweep itself. better-glimm reuses that engine as-is and only adds the router wiring glimm does not ship. It re-exports the glimm core and React provider, so every glimm prop and sweep option works exactly as documented in the glimm docs at https://glimm.dev#props. If you know glimm, you know this package.

## Why this exists

glimm ships a vanilla core, a React provider that works with any React router, and a Next-only helper set. If you use TanStack Router, SvelteKit, Vue Router, Nuxt, or Astro, there is no official adapter. better-glimm fills that gap with one thin adapter per router. No engine fork, no duplicated shaders.

## Install

```bash
npm install better-glimm
```

That is all. glimm installs automatically as a dependency of better-glimm. Do not install it separately. Then add only the peer your app needs, like react, @tanstack/react-router, svelte, vue with vue-router, or astro.

## Entry points

| Import                | Use for                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| better-glimm          | Vanilla core re-export plus interceptLinks                              |
| better-glimm/react    | GlimmProvider, useGlimm, useInterceptLinks for any React router         |
| better-glimm/tanstack | TransitionLink, useTransitionRouter, InterceptLinks for TanStack Router |
| better-glimm/svelte   | setupGlimm for SvelteKit                                                |
| better-glimm/vue      | setupGlimmVue for Vue Router and Nuxt                                   |
| better-glimm/astro    | setupGlimmAstro for Astro                                               |

## How it works

Each adapter intercepts same-origin link clicks, plays a sweep, and navigates at the midpoint.

Links that skip the sweep navigate instantly. That covers modifier clicks, right clicks, external URLs, same-page hashes, download links, target blank, and anything marked with `data-glimm-skip`.

No WebGL falls back to plain navigation. Server renders no-op. Reduced motion defaults to instant navigation unless you pass the sweep variant.

## Use

TanStack Router.

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

```tsx
import { TransitionLink, useTransitionRouter } from "better-glimm/tanstack";

<TransitionLink to="/about" sweep={{ palette: "berry" }}>
  About
</TransitionLink>;

const router = useTransitionRouter();
router.push("/dashboard", { palette: "ember" });
```

Any other React router. Pass your own navigate function.

```tsx
import { GlimmProvider, useInterceptLinks } from "better-glimm/react";
import { useNavigate } from "react-router-dom";

function AutoLinks() {
  const navigate = useNavigate();
  useInterceptLinks((href) => navigate(href));
  return null;
}
```

SvelteKit.

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

Vue.

```ts
import { setupGlimmVue } from "better-glimm/vue";

const glimm = setupGlimmVue({ canvas: canvasEl.value!, router });
onUnmounted(() => glimm.destroy());
```

Astro.

```astro
<canvas id="glimm" transition:persist />
<script>
  import { navigate } from "astro:transitions/client";
  import { setupGlimmAstro } from "better-glimm/astro";
  const canvas = document.querySelector("#glimm") as HTMLCanvasElement;
  setupGlimmAstro({ canvas, navigate });
</script>
```

## Options

These are glimm options. Pass them as provider defaults or per-navigation overrides. Defaults shown.

| Option       | Default | What it does                                                                          |
| ------------ | ------- | ------------------------------------------------------------------------------------- |
| palette      | prism   | Band colors. prism, berry, lagoon, citrus, azure, ember, or a custom a b c d set      |
| direction    | ltr     | Sweep side. ltr, rtl, ttb, btt                                                        |
| easing       | ease    | Band pacing. 10 built-ins like linear, snap, back, easeOutQuart, or your own function |
| sweepMs      | 1100    | How long the band takes to cross                                                      |
| outroMs      | 220     | Fade time after the crossing                                                          |
| midpoint     | 0.56    | Point in the sweep where navigation runs                                              |
| peakAlpha    | 1       | Caps band opacity, 0 to 1.5                                                           |
| brightness   | 1       | Scales band RGB. Try 0.85 on dark backgrounds                                         |
| bandTight    | 14      | Band focus. Lower reads wider and softer                                              |
| waveAmount   | 0       | Edge wobble, 0 to 2. 0 keeps a straight edge                                          |
| rippleAmount | 1       | Vertical ripple texture, 0 to 2                                                       |
| waveSpeed    | 1       | Shader motion speed, 0 to 3                                                           |

Palettes and easings resolve by name. `sweep={{ palette: "berry", direction: "rtl" }}` overrides the provider for one navigation. Svelte, Vue, and Astro take the same shape through `defaults` and per-call options.

## Credit

Engine by [Noman Ijaz](https://x.com/nomandsign) via [glimm](https://glimm.dev), MIT. Source at [github.com/nomanjack/glimm](https://github.com/nomanjack/glimm). Adapters here are original.
