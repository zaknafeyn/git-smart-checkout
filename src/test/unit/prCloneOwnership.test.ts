import * as assert from 'assert';
import { ExtensionContext } from 'vscode';

import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { PrCloneService } from '../../services/prCloneService';
import { PrCloneWebViewProvider } from '../../view/PrCloneWebViewProvider';

describe('PrCloneWebViewProvider disposal', () => {
  it('does not dispose the shared PR clone service it does not own', () => {
    let disposeCalls = 0;
    let subscriptionDisposeCalls = 0;
    const service = {
      onDidChangeRepository: () => ({
        dispose: () => {
          subscriptionDisposeCalls++;
        },
      }),
      dispose: () => {
        disposeCalls++;
      },
    } as unknown as PrCloneService;
    const provider = new PrCloneWebViewProvider(
      {} as ExtensionContext,
      {} as LoggingService,
      {} as ConfigurationManager,
      service
    );

    provider.dispose();

    assert.strictEqual(subscriptionDisposeCalls, 1);
    assert.strictEqual(disposeCalls, 0);
  });
});
