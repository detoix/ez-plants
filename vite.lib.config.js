/**
 * @type {import('vite').UserConfig}
 */
export default {
  build: {
    outDir: './build',
    // Note: Vite's library mode inlines every asset as a base64 data URI and
    // ignores `assetsInlineLimit`, so each plant's leaf.webp is embedded in the
    // bundle (~270 kB). That keeps the published package self-contained, which
    // is what library rule 7 asks for. The plates remain real files in `src`,
    // which is what a copied plant folder carries.
    lib: {
      entry: './src/lib/index.js',
      name: '@detoix/ez-plants',
      fileName: (format) => `ez-plants.${format}.js`,
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
  resolve: {
    // `three` is external here, so this is belt-and-braces: it keeps any code
    // path that does resolve three (a plugin, a transitively pulled copy under
    // `@three.ez/instanced-mesh`) collapsed onto one module. Two copies make
    // `USE_INSTANCING_INDIRECT` vanish from the shader silently. See
    // vite.app.config.js for the full explanation.
    dedupe: ['three'],
  },
  // Declarations are emitted by `tsc -p tsconfig.json` (see build:lib) rather
  // than vite-plugin-dts. The plugin's bundled api-extractor breaks across
  // TypeScript releases and rewrites the hand-authored ./types entry.
};
