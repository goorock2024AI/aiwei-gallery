#!/usr/bin/env node
// build-version.js — 构建时注入版本号 + 缓存标记
// 1. 从 VERSION 文件读取语义版本号
// 2. 从 git 获取当前 commit 短哈希作为缓存标记
// 3. 替换 deploy-pkg/app/index.html 中的占位符
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// 读取 VERSION 文件
const versionPath = path.join(ROOT, 'VERSION');
let appVersion = '';
try {
  appVersion = fs.readFileSync(versionPath, 'utf-8').trim();
} catch {
  console.error('[build-version] 错误：未找到 VERSION 文件，使用默认值');
  appVersion = '0.0.0';
}

// 获取 git commit 短哈希作为缓存标记
let cacheBust = '';
try {
  cacheBust = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch {
  console.error('[build-version] 错误：无法获取 git commit，使用时间戳');
  cacheBust = Date.now().toString(36);
}

// 确定目标 index.html 路径
// 用法1：无参数 → deploy-pkg/app/index.html（deploy.sh 使用）
// 用法2：指定路径 → 直接处理该文件
let htmlPath;
const customPath = process.argv[2];
if (customPath) {
  if (customPath.endsWith('index.html')) {
    htmlPath = path.resolve(customPath);
  } else {
    htmlPath = path.resolve(customPath, 'index.html');
  }
} else {
  htmlPath = path.join(ROOT, 'deploy-pkg', 'app', 'index.html');
}
let html = '';
try {
  html = fs.readFileSync(htmlPath, 'utf-8');
} catch (e) {
  console.error('[build-version] 错误：未找到 ' + htmlPath);
  process.exit(1);
}

// 替换占位符
const replaced = html
  .replace(/__APP_VERSION__/g, `v${appVersion}`)
  .replace(/__CACHE_BUST__/g, cacheBust);

// 写回
fs.writeFileSync(htmlPath, replaced, 'utf-8');
console.log(`[build-version] ✅ 版本号: v${appVersion}  缓存标记: ${cacheBust}`);
