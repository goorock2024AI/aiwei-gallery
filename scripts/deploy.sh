#!/bin/bash
# 部署到 dist/（Cloudflare Pages 使用）
# 每次更新代码后，运行此脚本即可

rm -rf dist
mkdir -p dist
cp -r "00_工作台/运营数据管理/app/"* dist/
rm -rf dist/sql dist/历史数据种子.json

echo "✅ dist/ 已更新，可以 git push 部署了"