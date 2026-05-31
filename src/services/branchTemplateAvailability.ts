import { ExtensionConfig } from '../configuration/extensionConfig';
import { branchTemplateNeedsJira } from './branchTemplateService';
import { isJiraConfigured, testJiraConnection } from './jiraService';
import { LoggingService } from '../logging/loggingService';

export async function canShowCreateBranchFromTemplateCommand(
  config: ExtensionConfig,
  logService: LoggingService
): Promise<boolean> {
  const template = (config.branchTemplate ?? '').trim();
  if (template === '') {
    return false;
  }

  if (!branchTemplateNeedsJira(template)) {
    return true;
  }

  if (!isJiraConfigured(config.jira)) {
    return false;
  }

  return testJiraConnection(config.jira, logService);
}
