/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Pin a non-UTC timezone so local-day vs UTC-day bugs are caught.
    env: { TZ: 'America/Los_Angeles' },
  },
})
