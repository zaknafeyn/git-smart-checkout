import * as crypto from 'crypto';

/**
 * Generates a cryptographically random nonce for use in a webview Content
 * Security Policy. A fresh nonce must be generated on every webview load and
 * applied to every `<script>` tag so that `script-src 'nonce-<value>'` can be
 * used instead of the unsafe `'unsafe-inline'` directive.
 */
export const getNonce = (): string => crypto.randomBytes(16).toString('base64');
