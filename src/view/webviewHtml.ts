import { Uri, Webview } from 'vscode';

/**
 * Rewrites a built webview's `index.html`/`commits.html`/`stacks.html` for
 * use inside a `WebviewView`: resolves local asset paths to `webview.asWebviewUri`
 * URIs, tags every `<script>` with a per-load nonce, and injects a nonce-based
 * CSP into the `<meta http-equiv="Content-Security-Policy">` tag.
 *
 * The CSP replace is anchored to the `http-equiv="Content-Security-Policy"`
 * meta specifically — templates also have a `<meta name="viewport" content="...">`
 * earlier in `<head>`, and a bare `/content="[^"]*"/` match (non-global) hits
 * that one first, silently leaving the real CSP meta on its unusable
 * build-time placeholder value.
 */
export function buildWebviewHtml(html: string, webview: Webview, extensionUri: Uri, nonce: string): string {
  let result = html.replace(/(href|src)="([^"]+)"/g, (match, attr: string, assetPath: string) => {
    if (assetPath.startsWith('/') || assetPath.startsWith('http')) {
      return match;
    }
    const assetUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'dist', 'webview', assetPath));
    return `${attr}="${assetUri}"`;
  });

  result = result.replace(/<script\b/g, `<script nonce="${nonce}"`);

  result = result.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"[^>]*\scontent=)"[^"]*"/i,
    `$1"default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';"`
  );

  return result;
}
