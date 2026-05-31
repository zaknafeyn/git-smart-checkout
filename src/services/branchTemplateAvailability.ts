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
