// Config file for running the demo locally.
//
// Dev (`vite` / `npm run dev`)   → alias points to lib source for instant HMR.
// Prod (`vite build`)            → alias points to the prebuilt lib artifact.
import path from 'path';

/**
 * @type {import('vite').UserConfigFn}
 */
export default ({ command }) => ({
  build: {
    emptyOutDir: true,
    outDir: '../../dist',
    sourcemap: true,
  },
  root: './src/app',
  resolve: {
    alias: {
      '@detoix/ez-plants': command === 'serve'
        ? path.resolve(__dirname, 'src/lib/index.js')
        : path.resolve(__dirname, 'build/ez-plants.es.js'),
    },
  },
  server: {
    hmr: true,
  },
  assetsInclude: ['**/*.frag', '**/*.vert'],
});
