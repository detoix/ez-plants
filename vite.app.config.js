// Config file for running the demo locally.
//
// Dev (`vite` / `npm run dev`)   → alias points to lib source for instant HMR.
// Prod (`vite build`)            → alias points to the prebuilt lib artifact.
import fs from 'fs';
import path from 'path';

/**
 * Serve directory pages the way a static host serves them.
 *
 * Directory routes give extensionless URLs for free in production: GitHub Pages
 * sees `/field` is a directory and redirects to `/field/`, which resolves to its
 * `index.html`. Vite's dev server does not, and answers `/field` with an empty
 * 200 -- so without this the URL you develop against is not the URL you ship.
 */
function directoryRoutes(root) {
  return {
    name: 'ez-plants-directory-routes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '/';
        const [pathname] = url.split('?');
        if (
          pathname === '/' ||
          pathname.endsWith('/') ||
          path.extname(pathname)
        ) {
          return next();
        }
        const candidate = path.join(root, pathname, 'index.html');
        if (!fs.existsSync(candidate)) return next();
        response.statusCode = 301;
        response.setHeader('Location', url.replace(pathname, `${pathname}/`));
        response.end();
      });
    },
  };
}

/**
 * @type {import('vite').UserConfigFn}
 */
export default ({ command }) => ({
  build: {
    emptyOutDir: true,
    outDir: '../../dist',
    rollupOptions: {
      // Two pages: the single-plant review page and the WebGPU field
      // walkaround. Without naming them here a
      // directory page works under `vite` and quietly vanishes from the build.
      //
      // The field lives in its own directory rather than as `field.html` so it
      // is served at `/field`, with no extension in the URL. That is a property
      // of the directory layout, not of a rewrite rule, so it holds on any
      // static host -- including GitHub Pages, which this deploys to and which
      // offers no rewrites of its own.
      input: {
        main: path.resolve(__dirname, 'src/app/index.html'),
        field: path.resolve(__dirname, 'src/app/field/index.html'),
      },
    },
  },
  root: './src/app',
  plugins: [directoryRoutes(path.resolve(__dirname, 'src/app'))],
  resolve: {
    // `build/` is intentionally shared with the primary checkout by symlink.
    // Keep the logical worktree path while resolving imports from those built
    // entries, otherwise Vite walks into the primary checkout's node_modules
    // instead of this worktree's versioned instanced-mesh artifact.
    preserveSymlinks: true,
    // An array, and in this order, on purpose. Alias matching is by prefix, so
    // a bare `@detoix/ez-plants` entry placed first would rewrite
    // `@detoix/ez-plants/field` into `.../src/lib/index.js/field`. The more
    // specific subpath has to be offered the import first.
    alias: [
      {
        find: '@detoix/ez-plants/field/webgpu',
        replacement:
          command === 'serve'
            ? path.resolve(__dirname, 'src/lib/field/index.webgpu.js')
            : path.resolve(__dirname, 'build/field/webgpu.js'),
      },
      {
        find: '@detoix/ez-plants/field',
        replacement:
          command === 'serve'
            ? path.resolve(__dirname, 'src/lib/field/index.js')
            : path.resolve(__dirname, 'build/field/index.js'),
      },
      {
        find: '@detoix/ez-plants',
        replacement:
          command === 'serve'
            ? path.resolve(__dirname, 'src/lib/index.js')
            : path.resolve(__dirname, 'build/ez-plants.es.js'),
      },
    ],
    // Mandatory, not cosmetic. If `@detoix/instanced-mesh` resolves another
    // `three`, its WebGL backend patches ShaderChunks the
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
