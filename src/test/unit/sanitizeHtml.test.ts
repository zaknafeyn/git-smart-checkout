import * as assert from 'assert';

import { JSDOM } from 'jsdom';

import { createSanitize } from '../../webview/utils/sanitizeHtml';

// DOMPurify needs a DOM. The extension-host test runner has no global `window`,
// so we drive the sanitizer through `createSanitize` with a jsdom window — the
// same code path the webview uses with its real browser window.
const sanitize = createSanitize(new JSDOM('').window as never);

describe('sanitizeHtml', () => {
  it('strips <script> tags', () => {
    const out = sanitize('<p>ok</p><script>alert(1)</script>');
    assert.ok(out.includes('<p>ok</p>'));
    assert.ok(!out.includes('<script'), 'script tag removed');
    assert.ok(!out.includes('alert(1)'), 'script body removed');
  });

  it('removes inline event handlers and neutralizes img onerror', () => {
    const out = sanitize('<img src="x" onerror="alert(1)">');
    assert.ok(!out.includes('onerror'), 'event handler attribute removed');
  });

  it('drops javascript: links but keeps the text', () => {
    const out = sanitize('<a href="javascript:alert(1)">click</a>');
    assert.ok(!out.includes('javascript:'), 'dangerous scheme removed');
    assert.ok(out.includes('click'), 'link text preserved');
  });

  it('keeps safe http links', () => {
    const out = sanitize('<a href="https://example.com" target="_blank" rel="noopener">x</a>');
    assert.ok(out.includes('href="https://example.com"'));
    assert.ok(out.includes('target="_blank"'));
  });

  it('preserves GFM tables', () => {
    const out = sanitize('<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>');
    assert.ok(out.includes('<table>'));
    assert.ok(out.includes('<th>H</th>'));
    assert.ok(out.includes('<td>v</td>'));
  });

  it('preserves details/summary, kbd and sub/sup', () => {
    const out = sanitize('<details><summary>s</summary>x</details><kbd>Ctrl</kbd><sub>a</sub><sup>b</sup>');
    assert.ok(out.includes('<details>'));
    assert.ok(out.includes('<summary>s</summary>'));
    assert.ok(out.includes('<kbd>Ctrl</kbd>'));
    assert.ok(out.includes('<sub>a</sub>'));
    assert.ok(out.includes('<sup>b</sup>'));
  });

  it('preserves disabled task-list checkboxes', () => {
    const out = sanitize(
      '<li class="task-list-item"><input type="checkbox" disabled checked> done</li>'
    );
    assert.ok(out.includes('type="checkbox"'));
    assert.ok(out.includes('disabled'));
    assert.ok(out.includes('task-list-item'));
  });
});
