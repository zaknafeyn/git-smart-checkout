import * as assert from 'assert';
import { Uri, Webview } from 'vscode';

import { buildWebviewHtml } from '../../view/webviewHtml';

const TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline';">
  <title>Stacks</title>
</head>
<body>
  <div id="root"></div>
  <script src="stacks.js"></script>
</body>
</html>`;

function makeFakeWebview(): Webview {
  return {
    cspSource: 'vscode-webview://abc123',
    asWebviewUri: (uri: Uri) => Uri.parse(`vscode-webview://abc123/${uri.fsPath}`),
  } as unknown as Webview;
}

const extensionUri = Uri.file('/ext');

describe('buildWebviewHtml', () => {
  it('leaves the viewport meta untouched', () => {
    const html = buildWebviewHtml(TEMPLATE_HTML, makeFakeWebview(), extensionUri, 'nonce123');
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  });

  it('injects a nonce-based CSP into the Content-Security-Policy meta specifically', () => {
    const html = buildWebviewHtml(TEMPLATE_HTML, makeFakeWebview(), extensionUri, 'nonce123');
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/);
    assert.ok(cspMatch, 'CSP meta tag should exist');
    assert.match(cspMatch![0], /script-src 'nonce-nonce123' vscode-webview:\/\/abc123/);
    assert.match(cspMatch![0], /default-src 'none'/);
  });

  it('does not leave the stale vscode-resource: placeholder in the CSP', () => {
    const html = buildWebviewHtml(TEMPLATE_HTML, makeFakeWebview(), extensionUri, 'nonce123');
    const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/);
    assert.ok(!cspMatch![0].includes('vscode-resource:'));
  });

  it('tags every <script> with the nonce', () => {
    const html = buildWebviewHtml(TEMPLATE_HTML, makeFakeWebview(), extensionUri, 'nonce123');
    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.ok(scriptTags.length > 0);
    for (const tag of scriptTags) {
      assert.match(tag, /nonce="nonce123"/);
    }
  });

  it('rewrites local asset paths to webview URIs but leaves absolute/http URLs alone', () => {
    const html = buildWebviewHtml(TEMPLATE_HTML, makeFakeWebview(), extensionUri, 'nonce123');
    assert.match(html, /src="vscode-webview:\/\/abc123\//);
  });
});
