import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'out/mcp-server',
    lib: {
      entry: resolve(__dirname, 'src/mcp-server/index.ts'),
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: [
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        'zod/v4',
        'fs',
        'path',
        'os',
        'node:fs',
        'node:path',
        'node:os'
      ]
    },
    minify: false,
    sourcemap: true
  }
})
