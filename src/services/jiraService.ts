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

export function describeJiraConfigFields(config: JiraConfig): string {
  const domain = config.domain.trim() !== '' ? 'set' : 'missing';
  const username = config.username.trim() !== '' ? 'set' : 'missing';
  const token = config.token.trim() !== '' ? 'set' : 'missing';
  return `domain=${domain}, username=${username}, token=${token}`;
}

export function isJiraConfigured(config: JiraConfig): boolean {
  return (
    config.domain.trim() !== '' &&
    config.username.trim() !== '' &&
    config.token.trim() !== ''
  );
}

export function normalizeJiraDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export function createJiraClient(
  config: JiraConfig,
  logService?: LoggingService
): JiraApi | undefined {
  if (!isJiraConfigured(config)) {
    logService?.warn(
      `[Jira] Cannot create client: incomplete configuration (${describeJiraConfigFields(config)})`
    );
    return undefined;
  }

  const host = normalizeJiraDomain(config.domain);

  return new JiraApi({
    protocol: 'https',
    host,
    username: config.username.trim(),
    password: config.token.trim(),
    apiVersion: '2',
    strictSSL: true,
  });
}

function formatJiraError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function testJiraConnection(
  config: JiraConfig,
  logService?: LoggingService
): Promise<boolean> {
  logService?.info(`[Jira] Testing connection (${describeJiraConfigFields(config)})`);

  if (!isJiraConfigured(config)) {
    logService?.warn('[Jira] Connection test skipped: domain, username, and token are all required');
    return false;
  }

  const host = normalizeJiraDomain(config.domain);
  logService?.info(
    `[Jira] Authenticating to https://${host} as ${config.username.trim()}`
  );

  const client = createJiraClient(config, logService);
  if (!client) {
    return false;
  }

  try {
    const user = await client.getCurrentUser();
    const accountId = (user as { accountId?: string }).accountId;
    const displayName = (user as { displayName?: string }).displayName;
    const emailAddress = (user as { emailAddress?: string }).emailAddress;

    logService?.info('[Jira] Connection test succeeded', {
      host,
      accountId,
      displayName,
      emailAddress,
    });
    return true;
  } catch (e) {
    logService?.warn(`[Jira] Connection test failed: ${formatJiraError(e)}`, e);
    return false;
  }
}

export function compareJiraIssuesForPicker(a: JiraIssueSummary, b: JiraIssueSummary): number {
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

const JIRA_SEARCH_PAGE_SIZE = 100;
const JIRA_SEARCH_MAX_PAGES = 100;

interface JiraEnhancedSearchResponse {
  issues?: Array<Parameters<typeof mapSearchIssue>[0]>;
  nextPageToken?: string;
  isLast?: boolean;
}

/**
 * Runs the JQL search through the Enhanced JQL Search endpoint
 * (`/rest/api/2/search/jql`). The legacy `/rest/api/2/search` endpoint used by
 * jira-client's `searchJira` has been removed from Jira Cloud, so requests to
 * it fail even when authentication succeeds. The new endpoint uses cursor-based
 * pagination via `nextPageToken` instead of `startAt`/`total`.
 */
async function searchIssuesWithJql(
  client: JiraApi,
  jql: string,
  fields: string[]
): Promise<Array<Parameters<typeof mapSearchIssue>[0]>> {
  const issues: Array<Parameters<typeof mapSearchIssue>[0]> = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let page = 0;

  while (page < JIRA_SEARCH_MAX_PAGES) {
    page += 1;

    const params = new URLSearchParams({
      jql,
      maxResults: String(JIRA_SEARCH_PAGE_SIZE),
      fields: fields.join(','),
    });
    if (nextPageToken) {
      params.set('nextPageToken', nextPageToken);
    }

    const result = (await client.genericGet(
      `search/jql?${params.toString()}`
    )) as JiraEnhancedSearchResponse;

    issues.push(...(result.issues ?? []));

    const token = result.nextPageToken;
    // Guard against the known Jira Cloud bug where nextPageToken chains
    // endlessly while re-serving the first page.
    if (result.isLast === true || !token || seenTokens.has(token)) {
      break;
    }
    seenTokens.add(token);
    nextPageToken = token;
  }

  return issues;
}

export async function fetchAssignedIssuesForCurrentUser(
  client: JiraApi,
  logService?: LoggingService
): Promise<JiraIssueSummary[]> {
  const jql = 'assignee = currentUser() ORDER BY key ASC';
  const rawIssues = await searchIssuesWithJql(client, jql, ['summary', 'status']);
  const sorted = sortJiraIssuesForPicker(rawIssues.map(mapSearchIssue));
  logService?.info(`[Jira] Loaded ${sorted.length} issue(s) assigned to current user`);
  return sorted;
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
  const client = createJiraClient(config, logService);

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
    issues = await fetchAssignedIssuesForCurrentUser(client, logService);
  } catch (e) {
    logService.warn('[Jira] Failed to fetch assigned issues; falling back to manual key entry', e);
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
