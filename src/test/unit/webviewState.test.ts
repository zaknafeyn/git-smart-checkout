import * as assert from 'assert';

import {
  readWebviewState,
  WebviewStateApi,
  writeWebviewState,
} from '../../common/vscode/webviewState';

interface TestState {
  view: 'input' | 'clone';
}

describe('webview state persistence', () => {
  it('loads and saves state through the VS Code webview API', () => {
    let persisted: TestState | undefined = { view: 'clone' };
    const api: WebviewStateApi<TestState> = {
      getState: () => persisted,
      setState: (state) => {
        persisted = state;
        return state;
      },
    };

    assert.deepStrictEqual(readWebviewState(api, { view: 'input' }), {
      view: 'clone',
    });

    writeWebviewState(api, { view: 'input' });
    assert.deepStrictEqual(persisted, { view: 'input' });
  });

  it('uses the initial state when VS Code has no persisted state', () => {
    const api: WebviewStateApi<TestState> = {
      getState: () => undefined,
      setState: (state) => state,
    };

    assert.deepStrictEqual(readWebviewState(api, { view: 'input' }), {
      view: 'input',
    });
  });
});
