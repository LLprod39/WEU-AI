#!/usr/bin/env node
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const zipPath = path.join(rootDir, 'dist.zip');

if (!fs.existsSync(distDir)) {
  process.stderr.write('Папка dist не найдена. Сначала выполните: npm run build\n');
  process.exit(1);
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on('close', () => resolve());
  archive.on('error', reject);
  output.on('error', reject);
  archive.pipe(output);
  archive.directory(distDir, false);
  archive.finalize();
});
