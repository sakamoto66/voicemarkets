/**
 * Build a Chrome extension zip for Chrome Web Store submission.
 * Includes only extension source files — excludes dev/test/docs artifacts.
 *
 * Usage: node scripts/build-zip.mjs
 * Output: dist/voicemarkets.zip
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import archiver from 'archiver';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, 'voicemarkets.zip');

// Directories and files to include in the extension zip.
const INCLUDE_PATHS = [
  'manifest.json',
  'popup',
  'background',
  'icons',
  '_locales',
];

// Glob-style patterns to exclude even within included directories.
const EXCLUDE_PATTERNS = [
  /\.DS_Store$/,
  /Thumbs\.db$/,
  /\.map$/,
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

async function buildZip() {
  mkdirSync(OUT_DIR, { recursive: true });

  const output = createWriteStream(OUT_FILE);
  const archive = archiver('zip', { zlib: { level: 9 } });

  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // Collect files and add them synchronously before finalizing.
    (async () => {
      for (const includePath of INCLUDE_PATHS) {
        const abs = join(ROOT, includePath);
        let info;
        try {
          info = await stat(abs);
        } catch {
          console.warn(`  skip (not found): ${includePath}`);
          continue;
        }

        if (info.isFile()) {
          if (!EXCLUDE_PATTERNS.some(p => p.test(abs))) {
            archive.file(abs, { name: includePath });
            console.log(`  + ${includePath}`);
          }
        } else {
          for await (const file of walk(abs)) {
            if (EXCLUDE_PATTERNS.some(p => p.test(file))) continue;
            const name = relative(ROOT, file);
            archive.file(file, { name });
            console.log(`  + ${name}`);
          }
        }
      }

      await archive.finalize();
    })().catch(reject);
  });

  const bytes = (await stat(OUT_FILE)).size;
  console.log(`\nBuilt: ${OUT_FILE} (${(bytes / 1024).toFixed(1)} KB)`);
}

buildZip().catch(err => {
  console.error(err);
  process.exit(1);
});
