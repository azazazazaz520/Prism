import { resolve } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const MANIFEST_JSON_SCHEMA =
  'https://raw.githubusercontent.com/your-org/prism/main/tools/prism-plugin-cli/src/manifest-schema.json';

export function init({ dir, name }) {
  if (existsSync(dir)) {
    console.error('目录已存在:', dir);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });

  const manifest = {
    id: `com.example.${name}`,
    name,
    version: '0.1.0',
    description: `${name} 插件`,
    author: 'your-name',
    main: 'main.js',
    engines: { prism: '>=0.1.0' },
    permissions: [],
  };

  const mainJS = `/**
 * ${name} 插件
 *
 * 入口文件，导出 activate(ctx) 函数。
 * ctx 提供: commands / views / menus / tasks / network / env / log / track
 */

export async function activate(ctx) {
  ctx.log('info', '${name} 已激活');

  // ── 注册命令 ──────────────────────────
  // ctx.commands.register('com.example.${name}.hello', () => {
  //   ctx.log('info', 'Hello!');
  // });

  // ── 注册视图 ──────────────────────────
  // import { h, ref } from 'vue'  (或使用 ctx.env.vue)
  // const Panel = ctx.env.vue.defineComponent({ ... });
  // ctx.views.registerPanel('com.example.${name}.panel', Panel);

  ctx.log('info', '${name} 就绪');
}
`;

  // 写入文件
  const manifestPath = resolve(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('created:', manifestPath);

  const mainPath = resolve(dir, 'main.js');
  writeFileSync(mainPath, mainJS);
  console.log('created:', mainPath);

  console.log(`\n插件模板 "${name}" 已生成。`);
  console.log(`  cd ${name}`);
  console.log('  prism-plugin check');
}
