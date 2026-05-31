import JiraApi from 'jira-client';
import * as vscode from 'vscode';

import { JiraConfig } from '../configuration/extensionConfig';
import { LoggingService } from '../logging/loggingService';

export interface JiraIssueSummary {
  key: string;
  summary: string;
  statusName: string;
  statusCategoryKey: string;
}

const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/i;

const STATUS_CATEGORY_ORDER: Record<string, number> = {
  new: 0,
  indeterminate: 1,
};

export function isJiraConfigured(config: JiraConfig): boolean {
  return (
    config.domain.trim() !== '' &&
    config.email.trim() !== '' &&
    config.token.trim() !== ''
  );
}

export function normalizeJiraDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export function createJiraClient(config: JiraConfig): JiraApi | undefined {
  if (!isJiraConfigured(config)) {
    return undefined;
  }

  const host = normalizeJiraDomain(config.domain);

  return new JiraApi({
    protocol: 'https',
    host,
    username: config.email.trim(),
    password: config.token.trim(),
    apiVersion: '2',
    strictSSL: true,
  });
}

export async function testJiraConnection(
  config: JiraConfig,
  logService?: LoggingService
): Promise<boolean> {
  const client = createJiraClient(config);
  if (!client) {
    return false;
  }

  try {
    await client.getCurrentUser();
    logService?.info('[Jira] Connection test succeeded');
    return true;
  } catch (e) {
    logService?.warn('[Jira] Connection test failed', e);
    return false;
  }
}

export function compareJiraIssuesForPicker(a: JiraIssueSummary, b: JiraIssueSummary): number {
  const orderA = STATUS_CATEGORY_ORDER[a.statusCategoryKey] ?? 2;
  const orderB = STATUS_CATEGORY_ORDER[b.statusCategoryKey] ?? 2;
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' });
}

export function sortJiraIssuesForPicker(issues: JiraIssueSummary[]): JiraIssueSummary[] {
  return [...issues].sort(compareJiraIssuesForPicker);
}

function mapSearchIssue(issue: {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
  };
}): JiraIssueSummary {
  return {
    key: issue.key,
    summary: issue.fields?.summary ?? '',
    statusName: issue.fields?.status?.name ?? 'Unknown',
    statusCategoryKey: issue.fields?.status?.statusCategory?.key ?? 'unknown',
  };
}

export async function fetchActiveSprintAssignedIssues(
  client: JiraApi
): Promise<JiraIssueSummary[]> {
  const jql = 'assignee = currentUser() AND sprint in openSprints() ORDER BY rank ASC';
  const result = await client.searchJira(jql, {
    maxResults: 100,
    fields: ['summary', 'status'],
  });

  const issues = (result.issues ?? []).map(mapSearchIssue);
  return sortJiraIssuesForPicker(issues);
}

export async function fetchJiraIssueByKey(
  client: JiraApi,
  issueKey: string
): Promise<JiraIssueSummary | undefined> {
  try {
    const issue = await client.findIssue(issueKey.toUpperCase());
    return mapSearchIssue(issue as Parameters<typeof mapSearchIssue>[0]);
  } catch {
    return undefined;
  }
}

export async function promptForJiraIssueKey(): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter Jira issue key',
    placeHolder: 'e.g. PROJ-123',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return 'Issue key is required';
      }
      if (!JIRA_KEY_PATTERN.test(trimmed)) {
        return 'Enter a valid Jira key (e.g. PROJ-123)';
      }
      return undefined;
    },
  });
  return input?.trim().toUpperCase();
}

export async function pickJiraIssue(
  config: JiraConfig,
  logService: LoggingService
): Promise<JiraIssueSummary | undefined> {
  const client = createJiraClient(config);

  if (!client) {
    logService.warn('[Jira] Not configured; falling back to manual key entry');
    const key = await promptForJiraIssueKey();
    if (!key) {
      return undefined;
    }
    return { key, summary: '', statusName: '', statusCategoryKey: 'unknown' };
  }

  let issues: JiraIssueSummary[] = [];
  try {
    issues = await fetchActiveSprintAssignedIssues(client);
  } catch (e) {
    logService.warn('[Jira] Failed to fetch sprint issues; falling back to manual key entry', e);
    const key = await promptForJiraIssueKey();
    if (!key) {
      return undefined;
    }
    const fetched = await fetchJiraIssueByKey(client, key);
    return fetched ?? { key, summary: '', statusName: '', statusCategoryKey: 'unknown' };
  }

  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { issue?: JiraIssueSummary }>();
    quickPick.ignoreFocusOut = true;
    quickPick.placeholder = 'Select a Jira issue or type a key (e.g. PROJ-123) and press Enter';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    let settled = false;
    const finish = (issue: JiraIssueSummary | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      quickPick.hide();
      quickPick.dispose();
      resolve(issue);
    };

    const baseItems = issues.map((issue) => ({
      label: issue.key,
      description: issue.statusName,
      detail: issue.summary,
      issue,
    }));

    const setItems = (filter: string) => {
      const trimmed = filter.trim();
      const filtered = trimmed
        ? baseItems.filter(
            (item) =>
              item.label.toLowerCase().includes(trimmed.toLowerCase()) ||
              (item.detail ?? '').toLowerCase().includes(trimmed.toLowerCase())
          )
        : baseItems;

      if (trimmed && JIRA_KEY_PATTERN.test(trimmed)) {
        const upper = trimmed.toUpperCase();
        const exists = baseItems.some((item) => item.label === upper);
        if (!exists) {
          filtered.unshift({
            label: `Use "${upper}"`,
            description: 'Manual entry',
            detail: 'Fetch issue details when creating the branch',
            issue: { key: upper, summary: '', statusName: '', statusCategoryKey: 'unknown' },
          });
        }
      }

      quickPick.items = filtered;
    };

    setItems('');

    quickPick.onDidChangeValue((value) => setItems(value));

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected?.issue) {
        finish(undefined);
        return;
      }

      let issue = selected.issue;
      if (!issue.summary) {
        const fetched = await fetchJiraIssueByKey(client, issue.key);
        if (fetched) {
          issue = fetched;
        }
      }
      finish(issue);
    });

    quickPick.onDidHide(() => finish(undefined));

    quickPick.show();
  });
}
