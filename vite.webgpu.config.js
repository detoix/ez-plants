/**
 * Builds the WebGPU material adapters as their own entry point.
 *
 * It sits between the main library and `./field`: it needs `three/tsl` to
 * express effects as nodes, but unlike the field backend it must never reach
 * for `@detoix/instanced-mesh`. A consumer swaying a single tree should not
 * take the instancing package to do it. `three` and its subpaths stay
 * external -- see vite.field.config.js and src/lib/field/three-copy-guard.js
 * for why a second copy of `three` must never be bundled in here.
 *
 * @type {import('vite').UserConfig}
 */
export default {
  build: {
    outDir: './build/webgpu',
    emptyOutDir: true,
    lib: {
      entry: './src/lib/webgpu/index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: (id) => id === 'three' || id.startsWith('three/'),
    },
  },
  resolve: {
    dedupe: ['three'],
  },
};
