import * as assert from 'assert';

import { validateTagName } from '../../commands/createTagFromTemplateCommand/validateTagName';

describe('validateTagName', () => {
  describe('valid names', () => {
    const valid = [
      'v1.2.3',
      'mobile-v12.3.4-FEAT-123-3',
      'release-2024.01.01',
      'my-tag',
      'v0.0.1-rc1',
    ];
    for (const name of valid) {
      it(`accepts "${name}"`, () => {
        assert.strictEqual(validateTagName(name), undefined);
      });
    }
  });

  describe('invalid names', () => {
    it('rejects empty string', () => {
      assert.ok(validateTagName(''));
    });

    it('rejects whitespace-only', () => {
      assert.ok(validateTagName('   '));
    });

    it('rejects names with spaces', () => {
      assert.ok(validateTagName('my tag'));
    });

    it('rejects names with tabs', () => {
      assert.ok(validateTagName('my\ttag'));
    });

    it('rejects control characters', () => {
      assert.ok(validateTagName('tag\x00name'));
      assert.ok(validateTagName('tag\x1fname'));
    });

    it('rejects leading dash', () => {
      assert.ok(validateTagName('-v1.0'));
    });

    it('rejects double dot', () => {
      assert.ok(validateTagName('v1..0'));
    });

    it('rejects tilde', () => {
      assert.ok(validateTagName('v1~0'));
    });

    it('rejects caret', () => {
      assert.ok(validateTagName('v1^0'));
    });

    it('rejects colon', () => {
      assert.ok(validateTagName('v1:0'));
    });

    it('rejects question mark', () => {
      assert.ok(validateTagName('v1?0'));
    });

    it('rejects asterisk', () => {
      assert.ok(validateTagName('v1*0'));
    });

    it('rejects open bracket', () => {
      assert.ok(validateTagName('v1[0'));
    });

    it('rejects backslash', () => {
      assert.ok(validateTagName('v1\\0'));
    });

    it('rejects .lock suffix', () => {
      assert.ok(validateTagName('v1.0.lock'));
    });

    it('rejects trailing slash', () => {
      assert.ok(validateTagName('v1/'));
    });

    it('rejects @{ sequence', () => {
      assert.ok(validateTagName('v1@{0}'));
    });

    it('rejects backtick', () => {
      assert.ok(validateTagName('v1`cmd`'));
    });

    it('rejects dollar sign', () => {
      assert.ok(validateTagName('v1$VAR'));
    });

    it('rejects semicolon', () => {
      assert.ok(validateTagName('v1;rm -rf'));
    });

    it('rejects pipe', () => {
      assert.ok(validateTagName('v1|cmd'));
    });

    it('rejects ampersand', () => {
      assert.ok(validateTagName('v1&cmd'));
    });

    it('rejects single quote', () => {
      assert.ok(validateTagName("v1'cmd"));
    });

    it('rejects double quote', () => {
      assert.ok(validateTagName('v1"cmd'));
    });
  });
});
