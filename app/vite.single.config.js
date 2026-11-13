import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
export default defineConfig({ resolve: { alias: { 'maplibre-gl': '/src/maplibre-shim.js' } },
  plugins: [react(), viteSingleFile()], build: { outDir: 'single' } })
