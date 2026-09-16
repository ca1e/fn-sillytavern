#!/usr/bin/env node
// Pre-compile SillyTavern's frontend bundle into the persistent data root so
// the first app start does not stall on webpack (fnOS checkport can time out
// on slow NAS CPUs). Run with ST_DATA_ROOT pointing at the persistent data dir.

globalThis.DATA_ROOT = process.env.ST_DATA_ROOT;

if (typeof globalThis.DATA_ROOT !== 'string' || globalThis.DATA_ROOT.length === 0) {
    console.error('ST_DATA_ROOT env var is required');
    process.exit(1);
}

const { default: getWebpackServeMiddleware } = await import('./sillytavern/src/middleware/webpack-serve.js');
const devMiddleware = getWebpackServeMiddleware();
await devMiddleware.runWebpackCompiler({ pruneCache: true });
console.log('Frontend pre-compile finished.');
process.exit(0);
