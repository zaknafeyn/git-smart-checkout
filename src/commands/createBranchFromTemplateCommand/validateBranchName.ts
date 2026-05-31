export function validateBranchName(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return 'Branch name cannot be empty';
  }
  if (/\s/.test(name)) {
    return 'Branch name cannot contain whitespace';
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return 'Branch name contains control characters';
  }
  if (name.startsWith('-') || name.startsWith('.')) {
    return 'Branch name cannot start with "-" or "."';
  }
  if (name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) {
    return 'Branch name has invalid suffix';
  }
  if (name.includes('..')) {
    return 'Branch name cannot contain ".."';
  }
  if (/[~^:?*[\]\\]/.test(name)) {
    return 'Branch name contains forbidden characters (~ ^ : ? * [ ] \\)';
  }
  if (name.includes('@{')) {
    return 'Branch name cannot contain "@{"';
  }
  if (/[`$;|&<>()'"]/.test(name)) {
    return 'Branch name contains shell-unsafe characters';
  }
  const segments = name.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      return 'Branch name contains invalid path segment';
    }
    if (segment.startsWith('-')) {
      return 'Branch path segment cannot start with "-"';
    }
  }
  return undefined;
}
