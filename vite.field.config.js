/**
 * Builds the field renderer as a separate entry point, so consumers who only
 * want single plants never pull `@detoix/instanced-mesh` into their bundle.
 * That package and `three` both stay external — see library rule 8, and
 * `src/lib/field/three-copy-guard.js` for why a second copy of `three` must
 * never end up in here.
 *
 * @type {import('vite').UserConfig}
 */
export default {
  build: {
    outDir: './build/field',
    emptyOutDir: true,
    lib: {
      entry: {
        index: './src/lib/field/index.js',
        webgpu: './src/lib/field/index.webgpu.js',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) =>
        id === 'three' ||
        id.startsWith('three/') ||
        id === '@detoix/instanced-mesh' ||
        id.startsWith('@detoix/instanced-mesh/'),
    },
  },
  resolve: {
    // See vite.app.config.js. Doubly load-bearing here: this is the bundle
    // that talks to instanced-mesh.
    dedupe: ['three'],
  },
};
