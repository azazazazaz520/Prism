import { resolve, relative, join } from 'path';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import AdmZip from 'adm-zip';

function collectFiles(dir, baseDir, ignore) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (
      ignore.some((p) => (p.endsWith('/**') ? rel.startsWith(p.slice(0, -3)) : rel.startsWith(p)))
    )
      continue;
    if (statSync(full).isDirectory()) {
      result.push(...collectFiles(full, baseDir, ignore));
    } else {
      result.push({ full, rel });
    }
  }
  return result;
}

export async function pack({ cwd }) {
  const manifestPath = resolve(cwd, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('manifest.json 不存在，请先运行 prism-plugin init');
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    throw new Error('manifest.json 解析失败: ' + e.message);
  }

  if (!manifest.id || !manifest.version) {
    throw new Error('manifest.json 缺少 id 或 version 字段');
  }

  const outName = `${manifest.id}-${manifest.version}.prism-plugin`;
  const outPath = resolve(cwd, outName);

  const zip = new AdmZip();
  const files = collectFiles(cwd, cwd, ['node_modules', '.git', outName]);
  for (const { full, rel } of files) {
    zip.addFile(rel, readFileSync(full));
  }
  zip.writeZip(outPath);

  const { size } = statSync(outPath);
  console.log(`已生成: ${outName} (${(size / 1024).toFixed(1)} KB)`);
}
