import { ExtensionConfig, NamedTemplate } from '../configuration/extensionConfig';

/**
 * Normalizes a configured list of named templates: drops entries whose
 * `template` is empty/whitespace, and defaults a missing/empty `name` to the
 * template string so every surviving entry has a usable picker label.
 */
function normalizeNamedTemplates(entries: NamedTemplate[] | undefined): NamedTemplate[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const result: NamedTemplate[] = [];
  for (const entry of entries) {
    const template = (entry?.template ?? '').trim();
    if (!template) {
      continue;
    }
    const name = (entry?.name ?? '').trim() || template;
    result.push({ name, template });
  }
  return result;
}

/**
 * Resolves the effective list of named branch templates: the plural
 * `branchTemplates` setting when it has any valid entries, otherwise the
 * deprecated singular `branchTemplate` as a single synthesized entry, otherwise
 * an empty list.
 */
export function getBranchTemplates(config: ExtensionConfig): NamedTemplate[] {
  const plural = normalizeNamedTemplates(config.branchTemplates);
  if (plural.length > 0) {
    return plural;
  }
  const single = (config.branchTemplate ?? '').trim();
  return single ? [{ name: single, template: single }] : [];
}

/**
 * Resolves the effective list of named tag templates: the plural `tagTemplates`
 * setting when it has any valid entries, otherwise the deprecated singular
 * `tagTemplate` as a single synthesized entry, otherwise an empty list.
 */
export function getTagTemplates(config: ExtensionConfig): NamedTemplate[] {
  const plural = normalizeNamedTemplates(config.tagTemplates);
  if (plural.length > 0) {
    return plural;
  }
  const single = (config.tagTemplate ?? '').trim();
  return single ? [{ name: single, template: single }] : [];
}
