import {rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Remove only disposable compiler caches restored by an older CI build.
// Do not exclude paths from secret scanning or touch application output.
for (const relative of ['../.next/cache/turbopack', '../.netlify/.next/cache/turbopack']) {
  await rm(fileURLToPath(new URL(relative, import.meta.url)), {recursive:true, force:true});
}
