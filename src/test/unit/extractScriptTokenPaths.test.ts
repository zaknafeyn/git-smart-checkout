import * as assert from 'assert';

import { extractScriptTokenPaths } from '../../commands/previewTemplateCommand/extractScriptTokenPaths';

describe('extractScriptTokenPaths', () => {
  it('returns an empty array when there are no script tokens', () => {
    assert.deepStrictEqual(extractScriptTokenPaths('release/{jira-key}-{f:package.json:.version}'), []);
  });

  it('extracts the script path with no stream prefix', () => {
    assert.deepStrictEqual(extractScriptTokenPaths('v{s:./get-version.sh}'), ['./get-version.sh']);
  });

  it('extracts the script path with an explicit stream prefix', () => {
    assert.deepStrictEqual(extractScriptTokenPaths('v{s:stderr:./get-version.sh}'), ['./get-version.sh']);
  });

  it('extracts multiple script tokens in order', () => {
    assert.deepStrictEqual(
      extractScriptTokenPaths('{s:./a.sh}-{s:stdout:./b.sh}'),
      ['./a.sh', './b.sh']
    );
  });

  it('ignores non-script tokens', () => {
    assert.deepStrictEqual(
      extractScriptTokenPaths('{jira-key}-{f:package.json:.version}-{b:\\d+}-{r:1}'),
      []
    );
  });
});
