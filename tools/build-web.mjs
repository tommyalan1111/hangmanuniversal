/*
 * Copies only the files the game needs at runtime into www/ for Capacitor.
 * Keeping this explicit means node_modules, tools/ and .shots/ never ship in the APK.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www');

const FILES = ['index.html', 'styles.css'];
const DIRS = ['src', 'data'];

async function main() {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });

  for (const file of FILES) {
    await fs.copyFile(path.join(root, file), path.join(out, file));
  }
  for (const dir of DIRS) {
    await fs.cp(path.join(root, dir), path.join(out, dir), { recursive: true });
  }

  let bytes = 0;
  let count = 0;
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        bytes += (await fs.stat(full)).size;
        count += 1;
      }
    }
  }
  await walk(out);

  console.log(`www/ built: ${count} files, ${Math.round(bytes / 1024)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
