import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

// Obsidian provides these at runtime; never bundle them.
const external = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  'node:fs',
  'node:path',
  'node:child_process',
];

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  platform: 'node',
  external,
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  outfile: 'main.js',
  logLevel: 'info',
};

// manifest.json + styles.css already live at repo root next to main.js; nothing to copy here.
// `npm run install:vault` copies all three into the vault plugin dir.
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild watching…');
} else {
  await esbuild.build(options);
}
