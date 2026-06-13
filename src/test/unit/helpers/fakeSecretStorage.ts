import * as vscode from 'vscode';

/**
 * In-memory implementation of `vscode.SecretStorage` for unit tests. Fires
 * `onDidChange` on store/delete just like the real Secret Storage.
 */
export class FakeSecretStorage implements vscode.SecretStorage {
  private readonly store_ = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.store_.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.store_.set(key, value);
    this.emitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this.store_.delete(key);
    this.emitter.fire({ key });
  }

  /** Test-only: seed a value without firing change events. */
  seed(key: string, value: string): void {
    this.store_.set(key, value);
  }
}
