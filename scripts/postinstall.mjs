#!/usr/bin/env node
// Runs after `pnpm install`.
// On Android/Termux, node-gyp detects the OS as "android" and requires
// android_ndk_path — but Termux compiles natively without the NDK.
// This script patches the node-gyp header cache to define a default empty
// value for that variable, then rebuilds better-sqlite3.

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { createRequire } from 'module';

if (process.platform !== 'android') process.exit(0);

// Find the node-gyp cache for the current Node version
const nodeVersion = process.version.slice(1); // strip leading 'v'
const gypiPath = path.join(homedir(), '.cache', 'node-gyp', nodeVersion, 'include', 'node', 'common.gypi');

if (!existsSync(gypiPath)) {
  console.log('[postinstall] node-gyp headers not cached yet, skipping patch');
  process.exit(0);
}

const original = readFileSync(gypiPath, 'utf8');
if (!original.includes("'android_ndk_path%': ''")) {
  const patched = original.replace(
    "'error_on_warn%': 'false',",
    "'error_on_warn%': 'false',\n    'android_ndk_path%': '',"
  );
  if (patched === original) {
    console.warn('[postinstall] Could not find patch target in common.gypi — skipping');
  } else {
    writeFileSync(gypiPath, patched);
    console.log('[postinstall] Patched node-gyp common.gypi for Termux/Android native build');
  }
}

// pnpm rebuild silently no-ops in some pnpm versions on Android;
// run node-gyp directly in the package directory instead.
const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
} catch {
  console.error('[postinstall] Could not resolve better-sqlite3 — run pnpm install first');
  process.exit(1);
}

console.log('[postinstall] Rebuilding better-sqlite3 for Android arm64...');
const result = spawnSync('node-gyp', ['rebuild'], { cwd: pkgDir, stdio: 'inherit', shell: true });
if (result.status !== 0) {
  console.error('[postinstall] Rebuild failed. Make sure node-gyp is installed: pnpm add -g node-gyp');
  process.exit(result.status);
}

console.log('[postinstall] better-sqlite3 ready.');
