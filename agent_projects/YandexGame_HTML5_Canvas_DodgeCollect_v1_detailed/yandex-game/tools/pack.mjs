#!/usr/bin/env node
/**
 * Упаковывает папку dist в dist.zip в корне проекта (кроссплатформенно).
 * Запуск: node tools/pack.mjs (из корня проекта, после npm run build).
 */
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const outZip = join(root, 'dist.zip');

if (!existsSync(distDir)) {
  console.error('Папка dist не найдена. Сначала выполните: npm run build');
  process.exit(1);
}

const output = createWriteStream(outZip);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  // архив создан
});

archive.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

archive.pipe(output);
archive.directory(distDir, false);
await archive.finalize();
