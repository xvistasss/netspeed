// @ts-check
import { readFileSync } from 'fs';
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

import cloudflare from '@astrojs/cloudflare';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],

  adapter: cloudflare({ prerenderEnvironment: 'node' }),

  security: {
    checkOrigin: true
  },

  vite: {
    plugins: [
      tailwindcss(),
      {
        name: 'cloudflare-ssr-entry',
        configEnvironment(environmentName, options) {
          if (environmentName === 'prerender') {
            return {
              build: {
                rollupOptions: {
                  input: 'astro/entrypoints/prerender',
                  output: {
                    entryFileNames: 'prerender-entry-[name].js',
                    chunkFileNames: 'chunks/[name].[hash].js',
                    assetFileNames: 'assets/[name].[ext]',
                    ...(options.build?.rollupOptions?.output || {}),
                  },
                },
              },
            };
          }
          if (environmentName === 'client') {
            return {
              build: {
                rollupOptions: {
                  input: 'virtual:astro:noop',
                },
              },
            };
          }
        },
      }
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    optimizeDeps: {
      include: ['chart.js'],
    },
  }
});