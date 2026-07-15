import { ExtensionConfig } from '../configuration/extensionConfig';
import { branchTemplateNeedsJira } from './branchTemplateService';
import {
  describeJiraConfigFields,
  isJiraConfigured,
  testJiraConnection,
} from './jiraService';
import { LoggingService } from '../logging/loggingService';

export async function canShowCreateBranchFromTemplateCommand(
  config: ExtensionConfig,
  logService: LoggingService
): Promise<boolean> {
  const template = (config.branchTemplate ?? '').trim();
  if (template === '') {
    logService.debug('[Create Branch] Command hidden: branch template is empty');
    return false;
  }

  if (!branchTemplateNeedsJira(template)) {
    logService.info('[Create Branch] Command visible: branch template does not require Jira');
    return true;
  }

  logService.info(
    `[Create Branch] Branch template requires Jira; checking connection (${describeJiraConfigFields(config.jira)})`
  );

  if (!isJiraConfigured(config.jira)) {
    logService.warn(
      '[Create Branch] Command hidden: Jira is not fully configured (set domain, username, and token)'
    );
    return false;
  }

  const connected = await testJiraConnection(config.jira, logService);
  if (connected) {
    logService.info('[Create Branch] Command visible: Jira connection OK');
  } else {
    logService.warn(
      '[Create Branch] Command hidden: Jira connection test failed (see [Jira] logs above)'
    );
  }
  return connected;
}

/**
 * Availability for "GSC: Preview branch/tag template...". Unlike
 * canShowCreateBranchFromTemplateCommand, this does NOT require a live Jira
 * connection test: the preview command is designed to degrade gracefully when
 * Jira isn't configured (it renders a "needs Jira setup" hint inline instead
 * of refusing to run), so the command only needs at least one template to be
 * configured to be worth showing.
 */
export function canShowPreviewTemplateCommand(
  config: ExtensionConfig,
  logService: LoggingService
): boolean {
  const hasBranchTemplate = (config.branchTemplate ?? '').trim() !== '';
  const hasTagTemplate = (config.tagTemplate ?? '').trim() !== '';
  const visible = hasBranchTemplate || hasTagTemplate;
  logService.debug(
    `[Preview Template] Command visibility: ${visible} (branchTemplate=${hasBranchTemplate}, tagTemplate=${hasTagTemplate})`
  );
  return visible;
}
