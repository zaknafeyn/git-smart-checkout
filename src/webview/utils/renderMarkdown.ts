/**
 * Minimal, dependency-free Markdown -> HTML renderer used for the PR description
 * preview in the PR Clone webview.
 *
 * Safety: every piece of raw text is HTML-escaped *before* any markup is
 * injected, and only a fixed whitelist of tags is produced. Link targets are
 * scheme-validated, so a malicious `javascript:` URL in a PR body cannot be
 * turned into a clickable link. This makes the output safe to assign through
 * `dangerouslySetInnerHTML`.
 *
 * The goal is a faithful-enough preview (headings, emphasis, code, lists,
 * task lists, block quotes, links, rules), not full CommonMark/GFM compliance.
 */

const PLACEHOLDER = '';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Return the URL when it uses a safe scheme (http/https/mailto), is an anchor
 * or relative path, or carries no scheme at all. Returns `null` for anything
 * else (e.g. `javascript:`/`data:`) so the caller can fall back to plain text.
 */
const sanitizeUrl = (url: string): string | null => {
  const trimmed = url.trim();

  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[#/]/.test(trimmed)) {
    return trimmed;
  }

  // No scheme at all -> treat as a relative link.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  return null;
};

/**
 * Apply inline formatting to a single line of already HTML-escaped text. Code
 * spans and links are stashed behind placeholders before emphasis runs so that
 * characters inside them (e.g. underscores in a URL) are never reinterpreted.
 */
const renderInline = (escaped: string): string => {
  const tokens: string[] = [];
  const stash = (html: string): string => {
    tokens.push(html);
    return `${PLACEHOLDER}${tokens.length - 1}${PLACEHOLDER}`;
  };

  let result = escaped.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${code}</code>`));

  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, url) => {
    const safe = sanitizeUrl(url);
    if (!safe) {
      return match;
    }
    return stash(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  });

  result = result
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^A-Za-z0-9])_([^_]+)_(?=[^A-Za-z0-9]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');

  result = result.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_match, index) =>
    tokens[Number(index)]
  );

  return result;
};

const isBlank = (line: string): boolean => /^\s*$/.test(line);
const isFence = (line: string): boolean => /^\s*```/.test(line);
const isHeading = (line: string): boolean => /^#{1,6}\s+/.test(line);
const isQuote = (line: string): boolean => /^\s*>\s?/.test(line);
const isUnordered = (line: string): boolean => /^\s*[-*+]\s+/.test(line);
const isOrdered = (line: string): boolean => /^\s*\d+[.)]\s+/.test(line);
const isRule = (line: string): boolean => /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);

const isBlockStart = (line: string): boolean =>
  isBlank(line) ||
  isFence(line) ||
  isHeading(line) ||
  isQuote(line) ||
  isUnordered(line) ||
  isOrdered(line) ||
  isRule(line);

export const renderMarkdown = (markdown: string): string => {
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (if present)
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (isBlank(line)) {
      i++;
      continue;
    }

    if (isRule(line)) {
      html.push('<hr />');
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    if (isQuote(line)) {
      const quoted: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    if (isUnordered(line)) {
      const items: string[] = [];
      while (i < lines.length && isUnordered(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, '');
        const task = content.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
          items.push(
            `<li class="task"><input type="checkbox" disabled${checked} /> ${renderInline(
              escapeHtml(task[2])
            )}</li>`
          );
        } else {
          items.push(`<li>${renderInline(escapeHtml(content))}</li>`);
        }
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (isOrdered(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        items.push(`<li>${renderInline(escapeHtml(content))}</li>`);
        i++;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i++;
    }
    const rendered = paragraph.map((entry) => renderInline(escapeHtml(entry))).join('<br />');
    html.push(`<p>${rendered}</p>`);
  }

  return html.join('\n');
};
