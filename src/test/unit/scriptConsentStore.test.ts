import * as assert from 'assert';
import * as vscode from 'vscode';

import { ScriptConsentStore } from '../../services/scriptConsentStore';

function makeMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const state = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (state.has(key) ? state.get(key) : defaultValue) as T,
    update: async (key: string, value: unknown) => {
      state.set(key, value);
    },
  };
}

describe('ScriptConsentStore', () => {
  it('has no consent for a workspace it has not seen', () => {
    const store = new ScriptConsentStore(makeMemento());
    assert.strictEqual(store.hasConsent('/repo/a'), false);
  });

  it('grants and remembers consent for a workspace', async () => {
    const store = new ScriptConsentStore(makeMemento());
    assert.strictEqual(store.hasConsent('/repo/a'), false);
    await store.grantConsent('/repo/a');
    assert.strictEqual(store.hasConsent('/repo/a'), true);
  });

  it('consent is scoped per workspace root', async () => {
    const store = new ScriptConsentStore(makeMemento());
    await store.grantConsent('/repo/a');
    assert.strictEqual(store.hasConsent('/repo/a'), true);
    assert.strictEqual(store.hasConsent('/repo/b'), false);
  });

  it('granting consent twice for the same repo does not duplicate entries', async () => {
    const memento = makeMemento();
    const store = new ScriptConsentStore(memento);
    await store.grantConsent('/repo/a');
    await store.grantConsent('/repo/a');
    assert.deepStrictEqual(memento.get('previewTemplate.scriptConsent.v1'), ['/repo/a']);
  });

  it('behaves as "no consent" and is a no-op when constructed without storage', async () => {
    const store = new ScriptConsentStore();
    assert.strictEqual(store.hasConsent('/repo/a'), false);
    await store.grantConsent('/repo/a'); // should not throw
    assert.strictEqual(store.hasConsent('/repo/a'), false);
  });
});
