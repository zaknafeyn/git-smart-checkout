import * as assert from 'assert';

import { formatPreviewDocument } from '../../commands/previewTemplateCommand/formatPreviewDocument';

describe('formatPreviewDocument', () => {
  it('renders template, result, and an aligned token table (spec example)', () => {
    const content = formatPreviewDocument({
      kind: 'branch',
      template: 'release/{jira-key}-{f:package.json:.version}',
      result: 'release/PROJ-123-0.13.0',
      tokens: [
        { raw: '{jira-key}', value: 'PROJ-123' },
        { raw: '{f:package.json:.version}', value: '0.13.0' },
      ],
    });

    const lines = content.split('\n');
    assert.strictEqual(lines[0], 'Template : release/{jira-key}-{f:package.json:.version}');
    assert.strictEqual(lines[1], 'Result   : release/PROJ-123-0.13.0');
    assert.strictEqual(lines[2], '');
    assert.strictEqual(lines[3], 'Token resolution:');
    assert.ok(lines[4].includes('{jira-key}'));
    assert.ok(lines[4].includes('→ PROJ-123'));
    assert.ok(lines[5].includes('{f:package.json:.version}'));
    assert.ok(lines[5].includes('→ 0.13.0'));
    // Arrows should be column-aligned (both rows same offset for '→').
    assert.strictEqual(lines[4].indexOf('→'), lines[5].indexOf('→'));
  });

  it('renders script/file errors with an ✗ ERROR prefix', () => {
    const content = formatPreviewDocument({
      kind: 'tag',
      template: '{s:./missing.sh}',
      result: '',
      tokens: [
        { raw: '{s:./missing.sh}', value: '', error: 'Script not found: ./missing.sh' },
      ],
    });
    assert.ok(content.includes('✗ ERROR: Script not found: ./missing.sh'));
  });

  it('renders Jira needs-setup errors without the ERROR prefix', () => {
    const content = formatPreviewDocument({
      kind: 'branch',
      template: '{jira-key}',
      result: '',
      tokens: [
        { raw: '{jira-key}', value: '', error: 'needs Jira setup (run GSC: Init Jira)' },
      ],
    });
    assert.ok(content.includes('✗ needs Jira setup (run GSC: Init Jira)'));
    assert.ok(!content.includes('ERROR: needs Jira setup'));
  });

  it('renders declined script consent as "skipped (not authorized)"', () => {
    const content = formatPreviewDocument({
      kind: 'tag',
      template: '{s:./build.sh}',
      result: '',
      tokens: [{ raw: '{s:./build.sh}', value: '', error: 'not authorized' }],
    });
    assert.ok(content.includes('✗ skipped (not authorized)'));
  });

  it('handles a template with no tokens at all', () => {
    const content = formatPreviewDocument({
      kind: 'branch',
      template: 'static-branch',
      result: 'static-branch',
      tokens: [],
    });
    assert.ok(content.includes('Template : static-branch'));
    assert.ok(content.includes('Result   : static-branch'));
    assert.ok(content.includes('no {jira-key}'));
  });
});
