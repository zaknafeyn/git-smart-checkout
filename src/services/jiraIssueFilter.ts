export type JiraAssigneeFilter = 'me' | 'anyone' | 'unassigned';
export type JiraStatusFilter = 'all' | 'todo' | 'inProgress' | 'done';

export interface JiraIssueFilter {
  assignee: JiraAssigneeFilter;
  /** Empty = use the configured `jira.projectKeys`. Non-empty = narrow to this subset. */
  projectKeys: string[];
  status: JiraStatusFilter;
}

export const DEFAULT_JIRA_ISSUE_FILTER: JiraIssueFilter = {
  assignee: 'me',
  projectKeys: [],
  status: 'all',
};

const ASSIGNEE_VALUES: JiraAssigneeFilter[] = ['me', 'anyone', 'unassigned'];
const STATUS_VALUES: JiraStatusFilter[] = ['all', 'todo', 'inProgress', 'done'];

/** Coerces a persisted/unknown value back into a valid filter; persisted state is untrusted. */
export function normalizeJiraIssueFilter(value: unknown): JiraIssueFilter {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_JIRA_ISSUE_FILTER;
  }
  const candidate = value as Partial<JiraIssueFilter>;

  const assignee = ASSIGNEE_VALUES.includes(candidate.assignee as JiraAssigneeFilter)
    ? (candidate.assignee as JiraAssigneeFilter)
    : DEFAULT_JIRA_ISSUE_FILTER.assignee;

  const status = STATUS_VALUES.includes(candidate.status as JiraStatusFilter)
    ? (candidate.status as JiraStatusFilter)
    : DEFAULT_JIRA_ISSUE_FILTER.status;

  const projectKeys = Array.isArray(candidate.projectKeys)
    ? candidate.projectKeys.filter((key): key is string => typeof key === 'string')
    : DEFAULT_JIRA_ISSUE_FILTER.projectKeys;

  return { assignee, projectKeys, status };
}

const ASSIGNEE_LABELS: Record<JiraAssigneeFilter, string> = {
  me: 'assigned to me',
  anyone: 'any assignee',
  unassigned: 'unassigned',
};

const STATUS_LABELS: Record<JiraStatusFilter, string> = {
  all: 'any status',
  todo: 'To Do',
  inProgress: 'In Progress',
  done: 'Done',
};

/** Human-readable summary for the picker title, e.g. "assigned to me · KEY, HOME · To Do". */
export function describeJiraIssueFilter(
  filter: JiraIssueFilter,
  configProjectKeys: string[]
): string {
  const effectiveProjectKeys = filter.projectKeys.length > 0 ? filter.projectKeys : configProjectKeys;
  const parts = [ASSIGNEE_LABELS[filter.assignee]];
  if (effectiveProjectKeys.length > 0) {
    parts.push(effectiveProjectKeys.join(', '));
  }
  if (filter.status !== 'all') {
    parts.push(STATUS_LABELS[filter.status]);
  }
  return parts.join(' · ');
}

function normalizeProjectKeys(projectKeys: string[]): string[] {
  return projectKeys
    .map((key) => key.trim().toUpperCase())
    .filter((key) => key !== '');
}

const STATUS_CATEGORY_CLAUSE: Record<Exclude<JiraStatusFilter, 'all'>, string> = {
  todo: 'statusCategory = "To Do"',
  inProgress: 'statusCategory = "In Progress"',
  done: 'statusCategory = "Done"',
};

const ORDER_BY_CLAUSE = 'ORDER BY created DESC';
const HAS_ORDER_BY = /\border\s+by\b/i;

/**
 * Builds the JQL query for the issue picker. When `customJql` is non-empty it
 * replaces all generated clauses entirely; `ORDER BY created DESC` is appended
 * only if the custom query doesn't already specify an order.
 */
export function buildIssuesJql(
  filter: JiraIssueFilter,
  configProjectKeys: string[],
  customJql = ''
): string {
  const trimmedCustomJql = customJql.trim();
  if (trimmedCustomJql !== '') {
    return HAS_ORDER_BY.test(trimmedCustomJql)
      ? trimmedCustomJql
      : `${trimmedCustomJql} ${ORDER_BY_CLAUSE}`;
  }

  const clauses: string[] = [];

  if (filter.assignee === 'me') {
    clauses.push('assignee = currentUser()');
  } else if (filter.assignee === 'unassigned') {
    clauses.push('assignee IS EMPTY');
  }

  const effectiveProjectKeys = normalizeProjectKeys(
    filter.projectKeys.length > 0 ? filter.projectKeys : configProjectKeys
  );
  if (effectiveProjectKeys.length > 0) {
    const inList = effectiveProjectKeys.map((key) => `"${key}"`).join(', ');
    clauses.push(`project IN (${inList})`);
  }

  if (filter.status !== 'all') {
    clauses.push(STATUS_CATEGORY_CLAUSE[filter.status]);
  }

  return clauses.length > 0 ? `${clauses.join(' AND ')} ${ORDER_BY_CLAUSE}` : ORDER_BY_CLAUSE;
}
