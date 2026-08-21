// Copies Scalar's browser bundle into dist so the runtime image can drop the package —
// @scalar/api-reference is a devDependency whose Vue UI tree is ~190 MB of node_modules,
// and the server only ever reads this one file (see src/engines/scalar.ts).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve('@scalar/api-reference')), 'browser', 'standalone.js');
const out = path.join('dist', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(src, path.join(out, 'scalar-standalone.js'));

// The package is pruned from the runtime image and publishes no LICENSE file of its own.
const license = path.resolve(import.meta.dirname, '..', 'licenses', 'scalar.LICENSE.txt');
fs.copyFileSync(license, path.join(out, 'scalar-standalone.LICENSE.txt'));
