import * as assert from 'assert';

import { buildCloneDescription } from '../../webview/utils/buildCloneDescription';

const pr = {
  number: 42,
  html_url: 'https://github.com/owner/repo/pull/42',
};

const header = '[Cloned from PR #42](https://github.com/owner/repo/pull/42)';

describe('buildCloneDescription', () => {
  it('uses the original PR body when present', () => {
    const result = buildCloneDescription(
      { ...pr, body: 'Original body\n\nwith details' },
      '## Template\n- [ ] item'
    );

    assert.strictEqual(result, `${header}\n\nOriginal body\n\nwith details`);
  });

  it('falls back to the template when the body is empty', () => {
    const template = '## Summary\n\n- [ ] Tests added';
    const result = buildCloneDescription({ ...pr, body: '' }, template);

    assert.strictEqual(result, `${header}\n\n${template}`);
  });

  it('treats a whitespace-only body as empty and uses the template', () => {
    const template = 'Checklist';
    const result = buildCloneDescription({ ...pr, body: '   \n  \t' }, template);

    assert.strictEqual(result, `${header}\n\n${template}`);
  });

  it('falls back to an empty description when neither body nor template exist', () => {
    const result = buildCloneDescription({ ...pr, body: '' });

    assert.strictEqual(result, `${header}\n\n`);
  });

  it('handles a null/undefined body', () => {
    const result = buildCloneDescription({ ...pr, body: null }, 'Template body');

    assert.strictEqual(result, `${header}\n\nTemplate body`);
  });

  it('always keeps the back-reference link on the first line', () => {
    const result = buildCloneDescription({ ...pr, body: 'anything' });

    assert.ok(result.startsWith(header));
  });
});
