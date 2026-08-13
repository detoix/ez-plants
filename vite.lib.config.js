/**
 * @type {import('vite').UserConfig}
 */
export default {
  build: {
    outDir: './build',
    lib: {
      entry: './src/lib/index.js',
      name: '@dgreenheck/ez-tree',
      fileName: (format) => `ez-tree.${format}.js`,
    },
    rollupOptions: {
      external: ['three'],
      output: {
        globals: {
          three: 'THREE',
        },
      },
    },
    sourcemap: true,
  },
  // Declarations are emitted by `tsc -p tsconfig.json` (see build:lib) rather
  // than vite-plugin-dts. The plugin's bundled api-extractor breaks across
  // TypeScript releases and rewrites the hand-authored ./types entry.
};
