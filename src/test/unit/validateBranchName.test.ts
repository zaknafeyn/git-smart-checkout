import * as assert from 'assert';

import { validateBranchName } from '../../commands/createBranchFromTemplateCommand/validateBranchName';

describe('validateBranchName', () => {
  describe('valid names', () => {
    const valid = [
      'feature/login',
      'vradchuk/KEY-123-ui-implement-modal',
      'release-2024.01.01',
      'my-branch',
      'v0.0.1-rc1',
    ];
    for (const name of valid) {
      it(`accepts "${name}"`, () => {
        assert.strictEqual(validateBranchName(name), undefined);
      });
    }
  });

  describe('invalid names', () => {
    it('rejects empty string', () => {
      assert.ok(validateBranchName(''));
    });

    it('rejects whitespace-only', () => {
      assert.ok(validateBranchName('   '));
    });

    it('rejects names with spaces', () => {
      assert.ok(validateBranchName('my branch'));
    });

    it('rejects leading dot', () => {
      assert.ok(validateBranchName('.hidden'));
    });

    it('rejects empty path segment', () => {
      assert.ok(validateBranchName('feature//login'));
    });

    it('rejects segment starting with dash', () => {
      assert.ok(validateBranchName('feature/-login'));
    });

    it('rejects double dot segment', () => {
      assert.ok(validateBranchName('feature/../login'));
    });

    it('rejects trailing slash', () => {
      assert.ok(validateBranchName('feature/'));
    });

    it('rejects forbidden characters', () => {
      assert.ok(validateBranchName('feature:login'));
      assert.ok(validateBranchName('feature?login'));
    });

    it('rejects shell-unsafe characters', () => {
      assert.ok(validateBranchName('feature|cmd'));
      assert.ok(validateBranchName("feature'cmd"));
    });
  });
});
