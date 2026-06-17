/**
 * HTML sanitizer for the rendered PR description preview.
 *
 * `renderMarkdown` runs `markdown-it` with `html: true`, so its output can
 * contain author-controlled markup (the PR body comes from an arbitrary GitHub
 * user). Before that HTML is handed to `dangerouslySetInnerHTML` it MUST pass
 * through here, where DOMPurify drops `<script>`, inline event handlers
 * (`onerror`, `onclick`, ...) and dangerous URL schemes (`javascript:`) while
 * preserving the Core-GFM element set GitHub renders.
 */

import createDOMPurify, { type Config, type WindowLike } from 'dompurify';

// Core-GFM tags beyond DOMPurify's defaults that we explicitly want to keep.
const ALLOWED_TAGS = [
  'details',
  'summary',
  'kbd',
  'sub',
  'sup',
  'input', // disabled task-list checkboxes
];

const ALLOWED_ATTR = [
  'target',
  'rel',
  'align', // GFM table column alignment
  'type',
  'checked',
  'disabled',
  'class', // task-list-item markers
];

const SANITIZE_CONFIG: Config = {
  ADD_TAGS: ALLOWED_TAGS,
  ADD_ATTR: ALLOWED_ATTR,
  // Allow http(s)/mailto/anchors/relative links; everything else (javascript:,
  // data:, vbscript:) is stripped by DOMPurify.
  ALLOW_DATA_ATTR: false,
};

type Sanitize = (html: string) => string;

/**
 * Build a sanitizer bound to a specific window. Used directly by unit tests
 * (which pass a jsdom window) and internally for the live webview window.
 */
export const createSanitize = (windowObj: WindowLike): Sanitize => {
  const purify = createDOMPurify(windowObj);
  return (html: string) => purify.sanitize(html, SANITIZE_CONFIG) as string;
};

let cached: Sanitize | undefined;

/**
 * Sanitize HTML using the global browser `window`. Available in the webview;
 * throws if called without a DOM (use {@link createSanitize} in that case).
 */
export const sanitizeHtml = (html: string): string => {
  if (!cached) {
    if (typeof window === 'undefined') {
      throw new Error('sanitizeHtml requires a DOM window; use createSanitize(window) instead.');
    }
    cached = createSanitize(window as unknown as WindowLike);
  }
  return cached(html);
};
