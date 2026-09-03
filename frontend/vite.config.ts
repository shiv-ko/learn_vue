import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const apiTarget = "https://gctpao66n5.execute-api.ap-northeast-3.amazonaws.com";

export default defineConfig({
  plugins: [vue()],
  define: {
    global: "globalThis",
  },
  server: {
    proxy: {
      "/todos": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (requestPath) => `/prod${requestPath}`,
      },
      "/bookmarks": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (requestPath) => `/prod${requestPath}`,
      },
    },
  },
});
