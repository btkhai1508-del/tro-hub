/**
 * Tests run inside the Workers runtime (Miniflare) with the real wrangler.toml bindings and a
 * fresh local D1 that every migration in ./migrations is applied to. Secrets are test values.
 *   npm test
 */
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: 'test-jwt-secret-only-for-vitest',
            CCCD_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', // 32 test bytes, base64
            SHEET_WRITES: 'off',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
