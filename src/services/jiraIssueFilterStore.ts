import * as vscode from 'vscode';

import { DEFAULT_JIRA_ISSUE_FILTER, JiraIssueFilter, normalizeJiraIssueFilter } from './jiraIssueFilter';

/**
 * Persists the last-used Jira issue picker filter. Scoped per workspace since
 * project keys are repo-specific, mirroring ScriptConsentStore.
 */
const STORAGE_KEY = 'jira.issueFilter.v1';

export class JiraIssueFilterStore {
  constructor(private readonly storage?: Pick<vscode.Memento, 'get' | 'update'>) {}

  get(): JiraIssueFilter {
    if (!this.storage) {
      return DEFAULT_JIRA_ISSUE_FILTER;
    }
    return normalizeJiraIssueFilter(this.storage.get(STORAGE_KEY));
  }

  async set(filter: JiraIssueFilter): Promise<void> {
    if (!this.storage) {
      return;
    }
    await this.storage.update(STORAGE_KEY, filter);
  }
}
