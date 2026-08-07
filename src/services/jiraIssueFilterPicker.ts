import JiraApi from 'jira-client';
import * as vscode from 'vscode';

import { JiraConfig } from '../configuration/extensionConfig';
import { LoggingService } from '../logging/loggingService';
import { JiraAssigneeFilter, JiraIssueFilter, JiraStatusFilter } from './jiraIssueFilter';

type FilterQuickPickItem = vscode.QuickPickItem & {
  apply?: (filter: JiraIssueFilter) => JiraIssueFilter;
};

const CHECK = '$(check)';

const ASSIGNEE_OPTIONS: Array<{ value: JiraAssigneeFilter; label: string; icon: string }> = [
  { value: 'me', label: 'Me', icon: 'person' },
  { value: 'anyone', label: 'Anyone', icon: 'organization' },
  { value: 'unassigned', label: 'Unassigned', icon: 'circle-slash' },
];

const STATUS_OPTIONS: Array<{ value: JiraStatusFilter; label: string; icon: string }> = [
  { value: 'all', label: 'Any status', icon: 'list-flat' },
  { value: 'todo', label: 'To Do', icon: 'circle-outline' },
  { value: 'inProgress', label: 'In Progress', icon: 'sync' },
  { value: 'done', label: 'Done', icon: 'check-all' },
];

/**
 * Builds the items for the filter sub-picker. When custom JQL is active it
 * overrides all generated clauses, so the picker shows a single explanatory
 * (non-selectable) item instead of the assignee/project/status groups.
 */
export function buildFilterQuickPickItems(
  filter: JiraIssueFilter,
  availableProjectKeys: string[],
  hasCustomJql: boolean
): FilterQuickPickItem[] {
  if (hasCustomJql) {
    return [
      {
        label: 'Custom JQL is active',
        description: 'git-smart-checkout.jira.customJql',
        detail: 'Clear it in settings to use these filters',
      },
    ];
  }

  const items: FilterQuickPickItem[] = [];

  items.push({ label: 'Assignee', kind: vscode.QuickPickItemKind.Separator });
  for (const option of ASSIGNEE_OPTIONS) {
    items.push({
      label: `$(${option.icon}) ${option.label}`,
      description: filter.assignee === option.value ? CHECK : undefined,
      apply: (f) => ({ ...f, assignee: option.value }),
    });
  }

  items.push({ label: 'Project', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: '$(list-flat) All configured',
    description: filter.projectKeys.length === 0 ? CHECK : undefined,
    apply: (f) => ({ ...f, projectKeys: [] }),
  });
  for (const key of availableProjectKeys) {
    items.push({
      label: `$(project) ${key}`,
      description:
        filter.projectKeys.length === 1 && filter.projectKeys[0] === key ? CHECK : undefined,
      apply: (f) => ({ ...f, projectKeys: [key] }),
    });
  }

  items.push({ label: 'Status', kind: vscode.QuickPickItemKind.Separator });
  for (const option of STATUS_OPTIONS) {
    items.push({
      label: `$(${option.icon}) ${option.label}`,
      description: filter.status === option.value ? CHECK : undefined,
      apply: (f) => ({ ...f, status: option.value }),
    });
  }

  return items;
}

/**
 * Resolves the project keys to offer in the filter picker: the configured
 * `jira.projectKeys` if set, otherwise a live lookup via the Jira API. Never
 * throws — failures are logged and result in an empty (project-agnostic) list.
 */
export async function getAvailableProjectKeys(
  client: JiraApi,
  config: JiraConfig,
  logService?: LoggingService
): Promise<string[]> {
  if (config.projectKeys.length > 0) {
    return config.projectKeys;
  }
  try {
    const projects = (await client.listProjects()) as Array<{ key?: string }>;
    return projects.map((project) => project.key).filter((key): key is string => Boolean(key));
  } catch (e) {
    logService?.warn('[Jira] Failed to list projects for filter picker', e);
    return [];
  }
}

/**
 * Shows the filter sub-picker and returns the updated filter, or `undefined`
 * if the user cancelled without picking an option.
 */
export async function pickJiraIssueFilter(
  currentFilter: JiraIssueFilter,
  config: JiraConfig,
  client: JiraApi,
  logService?: LoggingService
): Promise<JiraIssueFilter | undefined> {
  const hasCustomJql = config.customJql.trim() !== '';
  const availableProjectKeys = hasCustomJql
    ? []
    : await getAvailableProjectKeys(client, config, logService);

  const items = buildFilterQuickPickItems(currentFilter, availableProjectKeys, hasCustomJql);

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Filter issues',
    ignoreFocusOut: true,
  });

  return picked?.apply?.(currentFilter);
}
