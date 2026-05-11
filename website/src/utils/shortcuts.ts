const APPLE_COMMAND_OS_PATTERN = /(Macintosh|Mac OS X|iPhone|iPad|iPod)/i;

function isAppleCommandOS() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return APPLE_COMMAND_OS_PATTERN.test(navigator.userAgent);
}

export function getCommandPaletteShortcut() {
  return isAppleCommandOS()
    ? '⌘ + Shift + P'
    : 'Ctrl + Shift + P';
}

export function getExtensionsPanelShortcut() {
  return isAppleCommandOS()
    ? '⌘ + Shift + X'
    : 'Ctrl + Shift + X';
}
