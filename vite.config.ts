/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// De preview-build bundelt alles in één HTML-bestand; de normale build niet.
export default defineConfig({
  base: './',
  plugins: [react(), ...(process.env.VITE_PREVIEW ? [viteSingleFile()] : [])],
  // Migratietests draaien alle migraties in Postgres (PGlite); op de GitHub-server duurt dat langer dan 5 seconden.
  test: { testTimeout: 60000 },
})
