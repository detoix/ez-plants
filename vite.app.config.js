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
      '@detoix/ez-plants':
        command === 'serve'
          ? path.resolve(__dirname, 'src/lib/index.js')
          : path.resolve(__dirname, 'build/ez-plants.es.js'),
    },
    // Mandatory, not cosmetic. `@three.ez/instanced-mesh` installs its own
    // nested `three`, and with two copies loaded it patches ShaderChunks the
    // active renderer never reads: `USE_INSTANCING_INDIRECT` never reaches the
    // shader and the leaf-wind counter-rotation degrades silently, with no
    // error. Dedupe, never an alias — aliasing `three` to a directory breaks
    // the `three/addons/*` subpath exports.
    dedupe: ['three'],
  },
  server: {
    hmr: true,
  },
  assetsInclude: ['**/*.frag', '**/*.vert'],
});
