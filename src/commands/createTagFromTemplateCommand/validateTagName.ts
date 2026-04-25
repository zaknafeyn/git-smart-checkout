export function validateTagName(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return 'Tag name cannot be empty';
  }
  if (/\s/.test(name)) {
    return 'Tag name cannot contain whitespace';
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return 'Tag name contains control characters';
  }
  if (name.startsWith('-')) {
    return 'Tag name cannot start with "-"';
  }
  if (name.includes('..')) {
    return 'Tag name cannot contain ".."';
  }
  if (/[~^:?*[\]\\]/.test(name)) {
    return 'Tag name contains forbidden characters (~ ^ : ? * [ ] \\)';
  }
  if (name.endsWith('.lock') || name.endsWith('/')) {
    return 'Tag name has invalid suffix';
  }
  if (name.includes('@{')) {
    return 'Tag name cannot contain "@{"';
  }
  if (/[`$;|&<>()'"]/.test(name)) {
    return 'Tag name contains shell-unsafe characters';
  }
  return undefined;
}
