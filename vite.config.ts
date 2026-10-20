import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, type Plugin } from 'vite';

function zaloMiniAppAutoConfigPlugin(): Plugin {
  return {
    name: 'zalo-mini-app-auto-config',
    closeBundle() {
      const distDir = path.resolve(import.meta.dirname, 'dist');
      if (!fs.existsSync(distDir)) return;

      const assetsDir = path.join(distDir, 'assets');
      const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

      const cssFiles = files.filter(f => f.endsWith('.css')).map(f => `assets/${f}`);
      
      // Main entry script must have .module.js so Zalo loads it as an ES Module (<script type="module">)
      const mainJs = files.find(f => f.startsWith('index') && f.endsWith('.module.js'))
        || files.find(f => f.endsWith('.module.js'))
        || files.find(f => f.startsWith('index') && f.endsWith('.js'));

      const syncJs = mainJs ? [`assets/${mainJs}`] : [];

      const rootConfigPath = path.resolve(import.meta.dirname, 'app-config.json');
      let baseConfig: any = {
        app: {
          title: "EcoStay",
          headerTitle: { vi: "EcoStay - Trọ của tôi", en: "EcoStay" },
          headerColor: { light: "#ffffff", dark: "#0b0f14" },
          textColor: { light: "black", dark: "white" },
          leftButton: "none",
          statusBar: "transparent",
          actionBarHidden: true,
          hideAndroidBottomNavigationBar: false,
          hideIOSSafeAreaBottom: false,
          selfControlLoading: false
        }
      };

      if (fs.existsSync(rootConfigPath)) {
        try {
          baseConfig = JSON.parse(fs.readFileSync(rootConfigPath, 'utf8'));
        } catch {}
      }

      const finalConfig = {
        ...baseConfig,
        listCSS: cssFiles,
        listSyncJS: syncJs,
        listAsyncJS: [] // Must be empty: dynamic chunks are loaded by the ES module loader, not as standalone scripts
      };

      const jsonStr = JSON.stringify(finalConfig, null, 2);
      fs.writeFileSync(rootConfigPath, jsonStr);
      fs.writeFileSync(path.join(distDir, 'app-config.json'), jsonStr);
      console.log('[Zalo Mini App] Successfully configured assets in app-config.json:', {
        css: cssFiles,
        syncJS: syncJs,
        asyncJS: []
      });
    }
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), zaloMiniAppAutoConfigPlugin()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(
        process.env.VITE_API_BASE_URL || 'https://tro-hub.onrender.com'
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 3500,
      rollupOptions: {
        output: {
          // Output with .module.js extension so Zalo Mini App executes it as ES Module
          entryFileNames: 'assets/[name].[hash].module.js',
          chunkFileNames: 'assets/[name].[hash].module.js',
          assetFileNames: 'assets/[name].[hash].[ext]'
        }
      }
    },
    server: {
      allowedHosts: true as true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
