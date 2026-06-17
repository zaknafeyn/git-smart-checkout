import * as assert from 'assert';

import { renderMarkdown } from '../../webview/utils/renderMarkdown';

// `renderMarkdown` now returns raw (pre-sanitize) GFM HTML from markdown-it.
// Output carries trailing newlines and full block wrapping, so assertions use
// `includes`/normalized checks rather than exact-string equality. XSS/`javascript:`
// guarantees live in sanitizeHtml.test.ts, which covers the actual injection path.

const norm = (html: string): string => html.replace(/\n+/g, '').trim();

describe('renderMarkdown', () => {
  it('returns an empty string for empty input', () => {
    assert.strictEqual(renderMarkdown('').trim(), '');
  });

  it('renders headings at the right level', () => {
    assert.strictEqual(norm(renderMarkdown('# Title')), '<h1>Title</h1>');
    assert.strictEqual(norm(renderMarkdown('### Sub')), '<h3>Sub</h3>');
  });

  it('wraps plain text in a paragraph', () => {
    assert.strictEqual(norm(renderMarkdown('hello world')), '<p>hello world</p>');
  });

  it('renders bold, italic, strikethrough and inline code', () => {
    assert.ok(renderMarkdown('**bold**').includes('<strong>bold</strong>'));
    assert.ok(renderMarkdown('*italic*').includes('<em>italic</em>'));
    assert.ok(renderMarkdown('~~gone~~').includes('<s>gone</s>'));
    assert.ok(renderMarkdown('`code`').includes('<code>code</code>'));
  });

  it('does not reinterpret characters inside inline code', () => {
    const html = renderMarkdown('`a_b_c` and _real_');
    assert.ok(html.includes('<code>a_b_c</code>'), 'underscores in code stay literal');
    assert.ok(html.includes('<em>real</em>'), 'emphasis still works outside code');
  });

  it('renders safe links with target and rel attributes', () => {
    const html = renderMarkdown('[text](https://example.com)');
    assert.ok(html.includes('href="https://example.com"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
  });

  it('keeps underscores inside link URLs intact', () => {
    const html = renderMarkdown('[t](https://example.com/a_b_c)');
    assert.ok(html.includes('href="https://example.com/a_b_c"'));
    assert.ok(!html.includes('<em>'), 'URL underscores must not turn into emphasis');
  });

  it('autolinks bare URLs', () => {
    const html = renderMarkdown('see https://example.com for details');
    assert.ok(html.includes('href="https://example.com"'));
  });

  it('renders images', () => {
    const html = renderMarkdown('![alt text](https://example.com/i.png)');
    assert.ok(html.includes('<img'));
    assert.ok(html.includes('src="https://example.com/i.png"'));
    assert.ok(html.includes('alt="alt text"'));
  });

  it('renders unordered and nested lists', () => {
    const html = renderMarkdown('- one\n- two\n  - nested');
    assert.ok(html.includes('<ul>'));
    assert.ok(html.includes('<li>one'));
    assert.ok(html.includes('nested'));
    assert.ok(/<li>[\s\S]*<ul>[\s\S]*nested/.test(html), 'nested list rendered inside item');
  });

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done');
    assert.ok(html.includes('type="checkbox"'));
    assert.ok(html.includes('task-list-item'));
    assert.ok(html.includes('checked'), 'checked box rendered');
    assert.ok(html.includes('todo'));
    assert.ok(html.includes('done'));
  });

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. a\n2. b');
    assert.ok(html.includes('<ol>'));
    assert.ok(html.includes('<li>a</li>'));
    assert.ok(html.includes('<li>b</li>'));
  });

  it('renders GFM tables', () => {
    const html = renderMarkdown('| H1 | H2 |\n| --- | --- |\n| a | b |');
    assert.ok(html.includes('<table>'));
    assert.ok(html.includes('<th>H1</th>'));
    assert.ok(html.includes('<td>a</td>'));
  });

  it('passes through GitHub-allowed raw HTML (sanitized later)', () => {
    const html = renderMarkdown('<details><summary>more</summary>hidden</details>');
    assert.ok(html.includes('<details>'));
    assert.ok(html.includes('<summary>more</summary>'));
  });

  it('renders fenced code blocks without inline formatting', () => {
    const html = renderMarkdown('```\nconst a = **b**;\n```');
    assert.ok(html.includes('<pre>'));
    assert.ok(html.includes('<code>'));
    assert.ok(html.includes('const a = **b**;'), 'code content kept literal');
    assert.ok(!html.includes('<strong>'));
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> quoted');
    assert.ok(html.includes('<blockquote>'));
    assert.ok(html.includes('quoted'));
  });

  it('renders horizontal rules', () => {
    assert.ok(renderMarkdown('---').includes('<hr>'));
  });
});
