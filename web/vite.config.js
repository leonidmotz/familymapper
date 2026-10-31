import { defineConfig } from "vite";
import { resolve } from "node:path";

// base "./" keeps all paths relative, so the built site works on any static host.
// The game imports ../config.json (project root) directly, so the dev server may read one level up.
export default defineConfig({
  base: "./",
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      // Only the game is published; browser.html still works in `npm run dev`.
      input: { game: resolve(__dirname, "index.html") },
    },
  },
});
