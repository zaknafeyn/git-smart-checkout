/**
 * GitHub-Flavored-Markdown -> HTML renderer for the PR description preview in
 * the PR Clone webview.
 *
 * Rendering is delegated to `markdown-it` (CommonMark + GFM tables, strike-
 * through and autolinking) plus the task-list plugin, so the preview matches
 * the way GitHub renders a PR body — including tables, images, nested lists,
 * bare-URL autolinks and the small subset of raw HTML GitHub allows
 * (`<details>`, `<kbd>`, `<sub>`/`<sup>`, ...).
 *
 * The output is RAW HTML and is therefore *not* safe to inject on its own:
 * `html: true` lets author-controlled markup through. Callers MUST pass the
 * result through {@link sanitizeHtml} before assigning it to
 * `dangerouslySetInnerHTML`. Keeping this module DOM-free (no DOMPurify) lets
 * it run and be unit-tested in a plain Node context.
 */

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
}).use(taskLists, { enabled: true, label: false });

// Open links in the user's browser (VS Code intercepts webview link clicks) and
// harden the relationship to avoid reverse-tabnabbing.
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export const renderMarkdown = (markdown: string): string => md.render(markdown ?? '');
