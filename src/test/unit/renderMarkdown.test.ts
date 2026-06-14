import * as assert from 'assert';

import { renderMarkdown } from '../../webview/utils/renderMarkdown';

describe('renderMarkdown', () => {
  it('returns an empty string for empty input', () => {
    assert.strictEqual(renderMarkdown(''), '');
  });

  it('renders headings at the right level', () => {
    assert.strictEqual(renderMarkdown('# Title'), '<h1>Title</h1>');
    assert.strictEqual(renderMarkdown('### Sub'), '<h3>Sub</h3>');
  });

  it('wraps plain text in a paragraph', () => {
    assert.strictEqual(renderMarkdown('hello world'), '<p>hello world</p>');
  });

  it('renders bold, italic, strikethrough and inline code', () => {
    assert.strictEqual(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
    assert.strictEqual(renderMarkdown('*italic*'), '<p><em>italic</em></p>');
    assert.strictEqual(renderMarkdown('~~gone~~'), '<p><del>gone</del></p>');
    assert.strictEqual(renderMarkdown('`code`'), '<p><code>code</code></p>');
  });

  it('escapes HTML so embedded markup cannot execute', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'), 'raw <script> must not appear');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('does not reinterpret characters inside inline code', () => {
    const html = renderMarkdown('`a_b_c` and _real_');
    assert.ok(html.includes('<code>a_b_c</code>'), 'underscores in code stay literal');
    assert.ok(html.includes('<em>real</em>'), 'emphasis still works outside code');
  });

  it('renders safe links and rejects dangerous schemes', () => {
    const safe = renderMarkdown('[text](https://example.com)');
    assert.ok(safe.includes('<a href="https://example.com"'));
    assert.ok(safe.includes('rel="noopener noreferrer"'));

    const dangerous = renderMarkdown('[x](javascript:alert(1))');
    assert.ok(!dangerous.includes('<a '), 'javascript: links must not become anchors');
  });

  it('keeps underscores inside link URLs intact', () => {
    const html = renderMarkdown('[t](https://example.com/a_b_c)');
    assert.ok(html.includes('href="https://example.com/a_b_c"'));
    assert.ok(!html.includes('<em>'), 'URL underscores must not turn into emphasis');
  });

  it('renders unordered lists', () => {
    assert.strictEqual(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  });

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done');
    assert.ok(html.includes('type="checkbox" disabled />'), 'unchecked box rendered');
    assert.ok(html.includes('type="checkbox" disabled checked />'), 'checked box rendered');
    assert.ok(html.includes('todo'));
    assert.ok(html.includes('done'));
  });

  it('renders ordered lists', () => {
    assert.strictEqual(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  });

  it('renders fenced code blocks without inline formatting', () => {
    const html = renderMarkdown('```\nconst a = **b**;\n```');
    assert.ok(html.startsWith('<pre><code>'));
    assert.ok(html.includes('const a = **b**;'), 'code content kept literal');
    assert.ok(!html.includes('<strong>'));
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> quoted');
    assert.ok(html.includes('<blockquote>'));
    assert.ok(html.includes('quoted'));
  });

  it('renders horizontal rules', () => {
    assert.strictEqual(renderMarkdown('---'), '<hr />');
  });
});
