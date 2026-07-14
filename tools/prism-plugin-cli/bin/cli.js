#!/usr/bin/env node
import { resolve, basename } from 'path';
import { init } from '../src/commands/init.js';
import { check } from '../src/commands/check.js';
import { pack } from '../src/commands/pack.js';

const args = process.argv.slice(2);
const cmd = args[0];
const cwd = process.cwd();

const usage = `prism-plugin — Prism 插件 CLI 工具链

用法:
  prism-plugin init <name>      在当前目录下生成插件模板
  prism-plugin check            校验 manifest.json + 导入格式
  prism-plugin pack             打包为 .prism-plugin (ZIP)`;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(usage);
  process.exit(0);
}

switch (cmd) {
  case 'init': {
    const rawName = args[1];
    if (!rawName) {
      console.error('用法: prism-plugin init <name>');
      process.exit(1);
    }
    // 从路径中提取纯目录名作为插件名
    const name = basename(rawName);
    const dir = resolve(cwd, rawName);
    init({ dir, name });
    break;
  }
  case 'check': {
    const errors = check({ cwd });
    if (errors.length) {
      for (const e of errors) console.error('ERROR:', e);
      process.exit(1);
    }
    console.log('OK');
    break;
  }
  case 'pack': {
    pack({ cwd }).catch((e) => {
      console.error('ERROR:', e.message);
      process.exit(1);
    });
    break;
  }
  default:
    console.error('未知命令:', cmd);
    console.log(usage);
    process.exit(1);
}
