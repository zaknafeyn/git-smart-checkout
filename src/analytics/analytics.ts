import { PostHog } from 'posthog-node';

export enum AnalyticsEvent {
  ExtensionActivated = 'extension_activated',
  CheckoutToBranch = 'checkout_to_branch',
  CheckoutPreviousBranch = 'checkout_previous_branch',
  BranchCreated = 'branch_created',
  PullWithStash = 'pull_with_stash',
  PullRebaseWithStash = 'pull_rebase_with_stash',
  StashModeSwitched = 'stash_mode_switched',
  RebaseWithStash = 'rebase_with_stash',
  BranchFromTemplateCreated = 'branch_from_template_created',
  TagCreated = 'tag_created',
  TagPushed = 'tag_pushed',
  MoveToNewWorktree = 'move_to_new_worktree',
  PrCloneOpened = 'pr_clone_opened',
  PrCloneStarted = 'pr_clone_started',
  PrCloneCompleted = 'pr_clone_completed',
  PrCloneAborted = 'pr_clone_aborted',
  PrCloneConflictsResolved = 'pr_clone_conflicts_resolved',
  CheckoutByPR = 'checkout_by_pr',
  PrReviewInWorktree = 'pr_review_in_worktree',
  PrReviewWorktreeRemoved = 'pr_review_worktree_removed',
  WorktreeRemoved = 'worktree_removed',
  CopyStagedChangesToWorktree = 'copy_staged_changes_to_worktree',
  CopyWipChangesToWorktree = 'copy_wip_changes_to_worktree',
  CopyWipChangesFromWorktree = 'copy_wip_changes_from_worktree',
  MoveWipChangesFromWorktree = 'move_wip_changes_from_worktree',
  WorktreeDevTerminalOpened = 'worktree_dev_terminal_opened',
  CopyBranchName = 'copy_branch_name',
}

let client: PostHog | null = null;
let _enabled = false;
let _distinctId = 'anonymous';
let _commonProperties: Record<string, unknown> = {};

function isAnalyticsDisabledByEnvironment(): boolean {
  return process.env.GSC_DISABLE_TELEMETRY === '1' || Boolean(process.env.GSC_E2E_MODE);
}

function hasApiKey(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY);
}

function createClient(): void {
  if (client) { return; }
  client = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST,
    // Include PostHog's standard $geoip_* properties (including country) on
    // captured events instead of suppressing them via the SDK default.
    disableGeoip: false,
    // Autocapture would auto-send exceptions (stack traces, file paths, branch
    // names) bypassing the opt-out gate. Keep it off and rely solely on the
    // sanitized, opt-out-gated captureException below.
    enableExceptionAutocapture: false,
  });
}

function destroyClient(): void {
  void client?.shutdown();
  client = null;
}

export function initAnalytics(
  anonymousId: string,
  commonProperties: Record<string, unknown>
): void {
  // Only retain identity/metadata here. The client is created lazily by
  // setAnalyticsEnabled once we know telemetry is actually enabled, so that no
  // network client exists for opted-out users (or builds without an API key).
  _distinctId = anonymousId;
  _commonProperties = commonProperties;
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (isAnalyticsDisabledByEnvironment() || !hasApiKey()) {
    _enabled = false;
    destroyClient();
    return;
  }

  _enabled = enabled;
  if (enabled) {
    createClient();
  } else {
    destroyClient();
  }
}

export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
  if (isAnalyticsDisabledByEnvironment() || !_enabled || !client) { return; }
  client.capture({
    distinctId: _distinctId,
    event,
    properties: { ..._commonProperties, ...properties },
  });
}

export function captureException(error: unknown): void {
  if (isAnalyticsDisabledByEnvironment() || !_enabled || !client) { return; }
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
