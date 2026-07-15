import { TemplateTokenTrace } from '../../services/tagTemplateService';

/**
 * Renders the read-only preview document shown by the "Preview branch/tag
 * template..." command:
 *
 *   Template : release/{jira-key}-{f:package.json:.version}
 *   Result   : release/PROJ-123-0.13.0
 *
 *   Token resolution:
 *     {jira-key}                  → PROJ-123
 *     {f:package.json:.version}   → 0.13.0
 *     {s:./missing.sh}            → ✗ ERROR: script not found at <root>/missing.sh
 *
 * Failed tokens render inline with their error but never abort the preview —
 * every token is reported independently.
 */
export function formatPreviewDocument(params: {
  kind: 'branch' | 'tag';
  template: string;
  result: string;
  tokens: TemplateTokenTrace[];
}): string {
  const { kind, template, result, tokens } = params;

  const lines: string[] = [];
  lines.push(`Template : ${template}`);
  lines.push(`Result   : ${result}`);
  lines.push('');

  if (tokens.length === 0) {
    lines.push('Token resolution:');
    lines.push(`  (no {jira-key}/{jira-title}/{f:...}/{b:...}/{s:...}/{r:...} tokens in this ${kind} template)`);
    return lines.join('\n');
  }

  lines.push('Token resolution:');
  const widest = Math.max(...tokens.map((t) => t.raw.length));
  for (const token of tokens) {
    const label = token.raw.padEnd(widest, ' ');
    lines.push(`  ${label}  → ${formatTokenOutcome(token)}`);
  }

  return lines.join('\n');
}

function formatTokenOutcome(token: TemplateTokenTrace): string {
  if (!token.error) {
    return token.value ?? '';
  }
  if (token.error.includes('needs Jira setup')) {
    return `✗ ${token.error}`;
  }
  if (token.error.includes('not authorized')) {
    return '✗ skipped (not authorized)';
  }
  return `✗ ERROR: ${token.error}`;
}
