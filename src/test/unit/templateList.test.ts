import * as assert from 'assert';

import { ExtensionConfig, NamedTemplate } from '../../configuration/extensionConfig';
import { getBranchTemplates, getTagTemplates } from '../../services/templateList';

function makeConfig(overrides: {
  branchTemplate?: string;
  tagTemplate?: string;
  branchTemplates?: NamedTemplate[];
  tagTemplates?: NamedTemplate[];
}): ExtensionConfig {
  return {
    branchTemplate: overrides.branchTemplate ?? '',
    tagTemplate: overrides.tagTemplate ?? '',
    branchTemplates: overrides.branchTemplates ?? [],
    tagTemplates: overrides.tagTemplates ?? [],
    // Remaining ExtensionConfig fields are irrelevant to these helpers.
  } as unknown as ExtensionConfig;
}

describe('templateList', () => {
  describe('getBranchTemplates', () => {
    it('returns the plural list when it has valid entries', () => {
      const result = getBranchTemplates(
        makeConfig({
          branchTemplate: 'legacy/{r:1}',
          branchTemplates: [{ name: 'Feature', template: 'feat/{r:1}' }],
        })
      );
      assert.deepStrictEqual(result, [{ name: 'Feature', template: 'feat/{r:1}' }]);
    });

    it('falls back to the singular setting as one synthesized entry', () => {
      const result = getBranchTemplates(makeConfig({ branchTemplate: 'legacy/{r:1}' }));
      assert.deepStrictEqual(result, [{ name: 'legacy/{r:1}', template: 'legacy/{r:1}' }]);
    });

    it('drops entries with empty/whitespace template', () => {
      const result = getBranchTemplates(
        makeConfig({
          branchTemplates: [
            { name: 'Good', template: 'feat/{r:1}' },
            { name: 'Blank', template: '   ' },
            { name: 'Empty', template: '' },
          ],
        })
      );
      assert.deepStrictEqual(result, [{ name: 'Good', template: 'feat/{r:1}' }]);
    });

    it('defaults a missing/empty name to the template string', () => {
      const result = getBranchTemplates(
        makeConfig({ branchTemplates: [{ name: '  ', template: 'feat/{r:1}' }] })
      );
      assert.deepStrictEqual(result, [{ name: 'feat/{r:1}', template: 'feat/{r:1}' }]);
    });

    it('trims template and name', () => {
      const result = getBranchTemplates(
        makeConfig({ branchTemplates: [{ name: '  Feature  ', template: '  feat/{r:1}  ' }] })
      );
      assert.deepStrictEqual(result, [{ name: 'Feature', template: 'feat/{r:1}' }]);
    });

    it('returns empty when nothing is configured', () => {
      assert.deepStrictEqual(getBranchTemplates(makeConfig({})), []);
    });

    it('falls back to singular when the plural list has only invalid entries', () => {
      const result = getBranchTemplates(
        makeConfig({
          branchTemplate: 'legacy/{r:1}',
          branchTemplates: [{ name: 'Blank', template: '  ' }],
        })
      );
      assert.deepStrictEqual(result, [{ name: 'legacy/{r:1}', template: 'legacy/{r:1}' }]);
    });
  });

  describe('getTagTemplates', () => {
    it('returns the plural list when it has valid entries', () => {
      const result = getTagTemplates(
        makeConfig({ tagTemplates: [{ name: 'Release', template: 'v{r:1}' }] })
      );
      assert.deepStrictEqual(result, [{ name: 'Release', template: 'v{r:1}' }]);
    });

    it('falls back to the singular setting as one synthesized entry', () => {
      const result = getTagTemplates(makeConfig({ tagTemplate: 'v{r:1}' }));
      assert.deepStrictEqual(result, [{ name: 'v{r:1}', template: 'v{r:1}' }]);
    });

    it('returns empty when nothing is configured', () => {
      assert.deepStrictEqual(getTagTemplates(makeConfig({})), []);
    });
  });
});
