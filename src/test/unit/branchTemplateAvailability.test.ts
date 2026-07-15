import * as assert from 'assert';

import { AUTO_STASH_MODE_MANUAL, ExtensionConfig, JiraConfig, PULL_AFTER_CHECKOUT_FF_ONLY } from '../../configuration/extensionConfig';
import {
  canShowCreateBranchFromTemplateCommand,
  canShowPreviewTemplateCommand,
} from '../../services/branchTemplateAvailability';
import { mockLogService } from '../e2e/helpers/mockLogService';

function baseConfig(overrides: {
  branchTemplate?: string;
  tagTemplate?: string;
  jira?: JiraConfig;
} = {}): ExtensionConfig {
  return {
    mode: AUTO_STASH_MODE_MANUAL,
    useFastBranchList: true,
    recentBranchCount: 5,
    githubEnterpriseBaseUrl: '',
    defaultRemote: '',
    prClone: { checkoutAfterClone: 'ask' },
    showWhatsNew: 'minor',
    showStatusBar: true,
    defaultTargetBranch: 'main',
    defaultWorktreeDirectory: '',
    worktreeSetup: { copyFiles: [], command: '', applyToPrCloneWorktrees: false },
    prBranchPrefix: '',
    useInPlaceCherryPick: true,
    pullAfterCheckout: PULL_AFTER_CHECKOUT_FF_ONLY,
    logging: { enabled: false },
    telemetry: { enabled: false },
    tagTemplate: overrides.tagTemplate ?? '',
    pushTagWithoutConfirmation: false,
    tagRemote: 'origin',
    branchTemplate: overrides.branchTemplate ?? '',
    jira: overrides.jira ?? { domain: '', username: '', token: '', projectKeys: [] },
  };
}

describe('branchTemplateAvailability', () => {
  it('hides command when branch template is empty', async () => {
    const visible = await canShowCreateBranchFromTemplateCommand(baseConfig(), mockLogService);
    assert.strictEqual(visible, false);
  });

  it('hides command when branch template is whitespace only', async () => {
    const visible = await canShowCreateBranchFromTemplateCommand(
      baseConfig({ branchTemplate: '   ' }),
      mockLogService
    );
    assert.strictEqual(visible, false);
  });

  it('shows command when template has no Jira tokens', async () => {
    const visible = await canShowCreateBranchFromTemplateCommand(
      baseConfig({ branchTemplate: 'feature/{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, true);
  });

  it('hides command when template needs Jira but Jira is not configured', async () => {
    const visible = await canShowCreateBranchFromTemplateCommand(
      baseConfig({ branchTemplate: 'vradchuk/{jira-key}-{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, false);
  });

  it('hides command when template needs Jira title but credentials are incomplete', async () => {
    const visible = await canShowCreateBranchFromTemplateCommand(
      baseConfig({
        branchTemplate: '{jira-title:25:-}',
        jira: { domain: 'company.atlassian.net', username: 'user@example.com', token: '', projectKeys: [] },
      }),
      mockLogService
    );
    assert.strictEqual(visible, false);
  });
});

describe('canShowPreviewTemplateCommand', () => {
  it('hides command when neither template is configured', () => {
    assert.strictEqual(canShowPreviewTemplateCommand(baseConfig(), mockLogService), false);
  });

  it('hides command when both templates are whitespace only', () => {
    const visible = canShowPreviewTemplateCommand(
      baseConfig({ branchTemplate: '   ', tagTemplate: '  ' }),
      mockLogService
    );
    assert.strictEqual(visible, false);
  });

  it('shows command when only a branch template is configured', () => {
    const visible = canShowPreviewTemplateCommand(
      baseConfig({ branchTemplate: 'feature/{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, true);
  });

  it('shows command when only a tag template is configured', () => {
    const visible = canShowPreviewTemplateCommand(
      baseConfig({ tagTemplate: 'v{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, true);
  });

  it('shows command when a branch template needs Jira but Jira is not configured', () => {
    // Unlike canShowCreateBranchFromTemplateCommand, the preview command must
    // stay visible even without Jira configured — it degrades gracefully by
    // showing a "needs Jira setup" hint per-token instead of refusing to run.
    const visible = canShowPreviewTemplateCommand(
      baseConfig({ branchTemplate: 'vradchuk/{jira-key}-{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, true);
  });

  it('shows command when both templates are configured', () => {
    const visible = canShowPreviewTemplateCommand(
      baseConfig({ branchTemplate: 'feature/{r:1}', tagTemplate: 'v{r:1}' }),
      mockLogService
    );
    assert.strictEqual(visible, true);
  });
});
