import * as assert from 'assert';

import {
  PR_TEMPLATE_CANDIDATE_PATHS,
  decodeGitHubFileContent,
} from '../../common/api/ghClient';

const toBase64 = (value: string): string => Buffer.from(value, 'utf-8').toString('base64');

describe('decodeGitHubFileContent', () => {
  it('decodes base64 file content into UTF-8 text', () => {
    const text = '## Pull request template\n\n- [ ] Tests added';
    const decoded = decodeGitHubFileContent({ content: toBase64(text), encoding: 'base64' });

    assert.strictEqual(decoded, text);
  });

  it('tolerates the newline-wrapped base64 GitHub returns', () => {
    const text = 'line one\nline two';
    const wrapped = toBase64(text).replace(/(.{4})/g, '$1\n');
    const decoded = decodeGitHubFileContent({ content: wrapped, encoding: 'base64' });

    assert.strictEqual(decoded, text);
  });

  it('defaults to base64 when no encoding is provided', () => {
    const decoded = decodeGitHubFileContent({ content: toBase64('hello') });

    assert.strictEqual(decoded, 'hello');
  });

  it('returns undefined for unexpected encodings', () => {
    const decoded = decodeGitHubFileContent({ content: 'whatever', encoding: 'utf-8' });

    assert.strictEqual(decoded, undefined);
  });

  it('returns undefined when there is no content (e.g. a directory listing)', () => {
    assert.strictEqual(decodeGitHubFileContent({}), undefined);
    assert.strictEqual(decodeGitHubFileContent(undefined), undefined);
    assert.strictEqual(decodeGitHubFileContent(null), undefined);
  });
});

describe('PR_TEMPLATE_CANDIDATE_PATHS', () => {
  it('probes the canonical template locations in priority order', () => {
    assert.strictEqual(PR_TEMPLATE_CANDIDATE_PATHS[0], '.github/PULL_REQUEST_TEMPLATE.md');
    assert.ok(PR_TEMPLATE_CANDIDATE_PATHS.includes('PULL_REQUEST_TEMPLATE.md'));
    assert.ok(PR_TEMPLATE_CANDIDATE_PATHS.includes('docs/PULL_REQUEST_TEMPLATE.md'));
  });

  it('covers lowercase variants', () => {
    assert.ok(PR_TEMPLATE_CANDIDATE_PATHS.includes('.github/pull_request_template.md'));
  });
});
