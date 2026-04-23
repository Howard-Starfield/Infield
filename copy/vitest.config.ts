import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/vault-migration.ts", "src/ebay-sync.ts", "src/components/BuyerAvatar.ts"],
      exclude: ["**/*.test.ts"]
    }
  }
});
