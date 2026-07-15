/**
 * Scans a raw template string for {s:...} script tokens and returns the
 * script path portion of each (stripping the optional stream prefix), for
 * display in the script-execution consent prompt. This is intentionally a
 * lightweight scan — it does not need to validate or resolve paths, only to
 * surface what will be executed to the user before consent is granted.
 */
export function extractScriptTokenPaths(template: string): string[] {
  const paths: string[] = [];
  let i = 0;
  while (i < template.length) {
    if (template[i] === '{' && template[i + 1] === 's' && template[i + 2] === ':') {
      let depth = 1;
      let j = i + 1;
      while (j < template.length && depth > 0) {
        j++;
        if (template[j] === '{') {
          depth++;
        } else if (template[j] === '}') {
          depth--;
        }
      }
      if (depth === 0) {
        const args = template.substring(i + 3, j);
        const colonIdx = args.indexOf(':');
        const scriptPath = colonIdx === -1 ? args.trim() : args.substring(colonIdx + 1).trim();
        if (scriptPath) {
          paths.push(scriptPath);
        }
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return paths;
}
