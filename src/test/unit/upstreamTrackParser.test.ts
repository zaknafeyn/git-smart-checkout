import * as assert from 'assert';

import { parseUpstreamTrack } from '../../common/git/gitExecutor';

describe('parseUpstreamTrack', () => {
  it('parses branches that are both ahead and behind', () => {
    assert.deepStrictEqual(parseUpstreamTrack('[ahead 3, behind 2]'), [3, 2]);
  });

  it('defaults a missing behind count to zero', () => {
    assert.deepStrictEqual(parseUpstreamTrack('[ahead 3]'), [3, 0]);
  });

  it('defaults a missing ahead count to zero', () => {
    assert.deepStrictEqual(parseUpstreamTrack('[behind 2]'), [0, 2]);
  });

  it("returns 'gone' when the upstream branch was deleted", () => {
    assert.strictEqual(parseUpstreamTrack('[gone]'), 'gone');
  });

  it('returns undefined when there is no upstream configured', () => {
    assert.strictEqual(parseUpstreamTrack(''), undefined);
  });
});
