#!/usr/bin/env bash
set -e

TARGET_DIR="../../git-smart-checkout-pages"

yarn build

echo "Deploying to branch \"gh-web-site\" worktree dir at location $TARGET_DIR"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: directory $TARGET_DIR does not exist"
  exit 1
fi

cp -r dist/. "$TARGET_DIR/"
cd "$TARGET_DIR"

git add .
git commit -m "Update website build"

echo "Deployed to gh-web-site branch"
