import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'out/cli',
    lib: {
      entry: resolve(__dirname, 'src/cli/index.ts'),
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['fs', 'path', 'os', 'node:fs', 'node:path', 'node:os'],
      output: {
        // Inject the shebang so the built file is directly executable
        banner: '#!/usr/bin/env node'
      }
    },
    minify: false,
    sourcemap: true
  }
})
