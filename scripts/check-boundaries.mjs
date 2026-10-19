#!/usr/bin/env node
/*
 * Module boundary check (ADR-0002). A file may import another feature module only through that
 * module's public index (`src/modules/<name>/index.ts`), never its repository, controller or other
 * internals. Module indexes must not export routers (that creates import cycles with middleware).
 * Usage: node scripts/check-boundaries.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* fileURLToPath handles Windows drive letters and encoded characters (e.g. spaces in the path). */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const MODULES = path.join(SRC, 'modules');
const IMPORT_RE = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

const posix = (p) => p.split(path.sep).join('/');
const moduleOf = (file) => {
  const rel = posix(path.relative(MODULES, file));
  return rel.startsWith('..') ? null : rel.split('/')[0];
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

const violations = [];
for (const file of walk(SRC)) {
  const from = moduleOf(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2];
    const target = path.resolve(path.dirname(file), spec);
    const to = moduleOf(target);
    /* Only module-to-module imports are restricted; composition roots (routes.ts, database/entities.ts) mount module internals. */
    if (!from || !to || to === from) continue;
    const isIndex =
      posix(path.relative(path.join(MODULES, to), target)) === '' ||
      /^index(\.ts)?$/.test(posix(path.relative(path.join(MODULES, to), target)));
    if (!isIndex) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push(`${posix(path.relative(root, file))}:${line} imports "${spec}" — use the public API "src/modules/${to}" instead`);
    }
  }
}

if (violations.length) {
  console.error(`Module boundary violations (${violations.length}):\n  ` + violations.join('\n  '));
  process.exit(1);
}
console.log('Module boundaries OK');
