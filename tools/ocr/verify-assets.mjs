import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ocrRoot = join(projectRoot, 'public', 'ocr');
const manifestPath = join(ocrRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('OCR 资源清单没有待校验文件。');
}

for (const entry of manifest.files) {
  if (
    typeof entry.path !== 'string' ||
    !Number.isSafeInteger(entry.size) ||
    typeof entry.sha256 !== 'string'
  ) {
    throw new Error('OCR 资源清单格式无效。');
  }

  const assetPath = resolve(ocrRoot, entry.path);
  const relativePath = relative(ocrRoot, assetPath);
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error(`OCR 资源路径超出允许范围：${entry.path}`);
  }

  const metadata = await stat(assetPath);
  if (metadata.size !== entry.size) {
    throw new Error(`OCR 资源大小不一致：${entry.path}`);
  }

  const digest = createHash('sha256')
    .update(await readFile(assetPath))
    .digest('hex');
  if (digest !== entry.sha256.toLowerCase()) {
    throw new Error(`OCR 资源哈希不一致：${entry.path}`);
  }
}

console.log(`OCR 资源校验通过（${manifest.files.length} 个文件）。`);
