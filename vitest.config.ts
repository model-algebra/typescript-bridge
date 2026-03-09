import { defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
    ],
    test: {
        environment: "jsdom",
        globals: true,
        //setupFiles: "./src/test/setup.ts",
        css: false, // Disable CSS processing to avoid errors
        pool: 'vmThreads', // Resolves the CSS extension error
        server: {
            deps: {
            }
        }
    }
});
