import { PostHog } from 'posthog-node';

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

export function capture(event: string, properties?: Record<string, unknown>): void {
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
