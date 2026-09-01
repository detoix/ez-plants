import path from 'path';

/**
 * Builds the React Three Fiber wrapper as a separate entry point, so consumers
 * who only want the imperative Three.js classes never pull React into their
 * bundle. React, R3F, three and the core library stay external.
 *
 * @type {import('vite').UserConfig}
 */
export default {
  build: {
    outDir: './build/react',
    emptyOutDir: true,
    lib: {
      entry: './src/react/index.tsx',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'three',
        '@react-three/fiber',
        '@detoix/ez-plants',
      ],
    },
  },
  resolve: {
    alias: {
      // Type-only import of the core package resolves to the public surface.
      '@detoix/ez-plants': path.resolve(__dirname, 'build/ez-plants.es.js'),
    },
    // See vite.app.config.js — a second `three` copy silently disables
    // instanced-mesh shader patching.
    dedupe: ['three'],
  },
  // Declarations are emitted by `tsc -p tsconfig.react.json` rather than
  // vite-plugin-dts: the bundled v3 compiler cannot parse a JSX tsconfig.
};
