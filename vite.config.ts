import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const rustTargetSegment = '\\src-tauri\\target\\';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // Cargo continuously creates/replaces executables under src-tauri/target.
      // Watching those files on Windows (especially inside OneDrive) can race
      // with the linker and surface as EBUSY from Node's FSWatcher.
      ignored: (path) => {
        const normalizedPath = path.replaceAll('/', '\\');
        return normalizedPath.includes(rustTargetSegment);
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' || process.platform === 'win32' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
});
