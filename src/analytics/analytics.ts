import { PostHog } from 'posthog-node';

export enum AnalyticsEvent {
  CheckoutToBranch = 'checkout_to_branch',
  CheckoutPreviousBranch = 'checkout_previous_branch',
  BranchCreated = 'branch_created',
  PullWithStash = 'pull_with_stash',
  StashModeSwitched = 'stash_mode_switched',
  RebaseWithStash = 'rebase_with_stash',
  TagCreated = 'tag_created',
  TagPushed = 'tag_pushed',
  PrCloneStarted = 'pr_clone_started',
  PrCloneCompleted = 'pr_clone_completed',
  PrCloneAborted = 'pr_clone_aborted',
  CheckoutByPR = 'checkout_by_pr',
}

let client: PostHog | null = null;
let _enabled = false;
let _distinctId = 'anonymous';
let _commonProperties: Record<string, unknown> = {};

export function initAnalytics(
  anonymousId: string,
  commonProperties: Record<string, unknown>
): void {
  _distinctId = anonymousId;
  _commonProperties = commonProperties;
  client = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST,
  });
}

export function setAnalyticsEnabled(enabled: boolean): void {
  _enabled = enabled;
}

export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (!_enabled || !client) { return; }
  client.capture({
    distinctId: _distinctId,
    event,
    properties: { ..._commonProperties, ...properties },
  });
}

export function captureException(error: unknown): void {
  if (!_enabled || !client) { return; }
  const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
  client.capture({
    distinctId: _distinctId,
    event: 'error',
    properties: { ..._commonProperties, error_type: errorType },
  });
}

export async function shutdownAnalytics(): Promise<void> {
  await client?.shutdown();
  client = null;
  _enabled = false;
}
