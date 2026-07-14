import { resolve, basename } from 'path';
import { readFileSync, createWriteStream, existsSync } from 'fs';
import archiver from 'archiver';

export async function pack({ cwd }) {
  // 读取 manifest 获取 id 和 version
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

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`已生成: ${outName} (${(archive.pointer() / 1024).toFixed(1)} KB)`);
      resolve();
    });

    archive.on('error', (e) => reject(e));
    archive.pipe(output);

    // 添加目录中所有文件，排除 node_modules / .git / 已生成的 .prism-plugin
    archive.glob('**/*', {
      cwd,
      ignore: ['node_modules/**', '.git/**', '*.prism-plugin'],
      dot: false,
    });

    archive.finalize();
  });
}
