import * as assert from 'assert';
import * as vscode from 'vscode';

import { DEFAULT_JIRA_ISSUE_FILTER, JiraIssueFilter } from '../../services/jiraIssueFilter';
import { JiraIssueFilterStore } from '../../services/jiraIssueFilterStore';

function makeMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const state = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (state.has(key) ? state.get(key) : defaultValue) as T,
    update: async (key: string, value: unknown) => {
      state.set(key, value);
    },
  };
}

describe('JiraIssueFilterStore', () => {
  it('returns the default filter when nothing has been stored', () => {
    const store = new JiraIssueFilterStore(makeMemento());
    assert.deepStrictEqual(store.get(), DEFAULT_JIRA_ISSUE_FILTER);
  });

  it('round-trips a filter through set/get', async () => {
    const store = new JiraIssueFilterStore(makeMemento());
    const filter: JiraIssueFilter = { assignee: 'anyone', projectKeys: ['KEY'], status: 'todo' };
    await store.set(filter);
    assert.deepStrictEqual(store.get(), filter);
  });

  it('normalizes a corrupt stored value back to the default', async () => {
    const memento = makeMemento();
    await memento.update('jira.issueFilter.v1', { assignee: 'nope', status: 42, projectKeys: 'KEY' });
    const store = new JiraIssueFilterStore(memento);
    assert.deepStrictEqual(store.get(), DEFAULT_JIRA_ISSUE_FILTER);
  });

  it('behaves as "default filter" and is a no-op when constructed without storage', async () => {
    const store = new JiraIssueFilterStore();
    assert.deepStrictEqual(store.get(), DEFAULT_JIRA_ISSUE_FILTER);
    await store.set({ assignee: 'anyone', projectKeys: [], status: 'done' }); // should not throw
    assert.deepStrictEqual(store.get(), DEFAULT_JIRA_ISSUE_FILTER);
  });
});
