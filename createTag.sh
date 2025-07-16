#!/bin/sh

# Usage: ./script.sh [version]
# If version is not provided as argument, the script uses $TAG_VERSION

# Determine version: first argument or $TAG_VERSION
VERSION=${1:-$TAG_VERSION}

if [ -z "$VERSION" ]; then
  echo "Error: No version provided as argument or in TAG_VERSION environment variable."
  exit 1
fi

echo "Using version: $VERSION"

# Tag and push
git tag -a "v$VERSION" -m "Release version $VERSION"
git push origin "tag" "v$VERSION"
