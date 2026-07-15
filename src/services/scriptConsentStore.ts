import * as vscode from 'vscode';

/**
 * Persists user consent to execute {s:...} script tokens from the template
 * preview command. Consent is scoped per workspace root: the first preview
 * containing a script token for a given repository prompts the user; the
 * answer is remembered so subsequent previews in the same repository don't
 * prompt again.
 */
const STORAGE_KEY = 'previewTemplate.scriptConsent.v1';

export class ScriptConsentStore {
  constructor(private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>) {}

  hasConsent(workspaceRoot: string): boolean {
    if (!this.storage) {
      return false;
    }
    const granted = this.storage.get<string[]>(STORAGE_KEY, []);
    return granted.includes(workspaceRoot);
  }

  async grantConsent(workspaceRoot: string): Promise<void> {
    if (!this.storage) {
      return;
    }
    const granted = this.storage.get<string[]>(STORAGE_KEY, []);
    if (!granted.includes(workspaceRoot)) {
      await this.storage.update(STORAGE_KEY, [...granted, workspaceRoot]);
    }
  }
}
