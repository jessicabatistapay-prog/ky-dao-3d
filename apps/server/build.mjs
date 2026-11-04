import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  external: ['express', 'socket.io'],
  // @kydao/engine là mã TypeScript trong repo, phải gộp vào bản build.
  plugins: [{
    name: 'bundle-engine',
    setup(b) {
      b.onResolve({ filter: /^@kydao\/engine/ }, async (args) => {
        const sub = args.path.replace('@kydao/engine', '');
        const map = { '': 'index.ts', '/protocol': 'protocol.ts', '/ai': 'ai/index.ts' };
        return { path: new URL(`../../packages/engine/src/${map[sub]}`, import.meta.url).pathname };
      });
    },
  }],
});
