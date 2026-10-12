import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.tsx",
    tanstack: "src/tanstack.tsx",
    svelte: "src/svelte.ts",
    vue: "src/vue.ts",
    astro: "src/astro.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  external: [
    "glimm",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@tanstack/react-router",
    "svelte",
    "svelte/store",
    "$app/navigation",
    "vue",
    "vue-router",
    "astro:transitions/client",
  ],
});
