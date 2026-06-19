import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Ignore DuckDB runtime files because the backend updates the WAL during dev.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '*.duckdb',
          '*.duckdb.wal',
          '*.duckdb.tmp',
          '**/*.duckdb',
          '**/*.duckdb.wal',
          '**/*.duckdb.tmp',
          '**/*.wal',
          '**/*.py',
          '**/*.pyc',
          '**/__pycache__/**',
          'dist/**',
          'node_modules/**',
        ],
      },
    },
  };
});
