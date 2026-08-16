import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  build: {
    outDir: "dist",
  },
  server: {
    // The save API is served by server/index.js, not by Vite. Proxying it here
    // means the client uses the same same-origin `/api/...` paths in dev as in
    // production, with no environment switch anywhere in src/.
    //
    // If that server is not running, the proxy fails, the save layer catches it
    // and the game runs local-only — which is exactly the degraded path it is
    // built to handle, so `npm run dev` alone still works.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
