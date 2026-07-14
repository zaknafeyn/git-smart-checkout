/**
 * Sentinel error thrown when the user dismisses a picker/input box (e.g. by
 * pressing Escape) instead of an actual failure. Callers should treat this
 * as plain cancellation — no error notification, no exception capture.
 */
export class UserCancelledError extends Error {
  constructor(message = 'Operation cancelled by the user') {
    super(message);
    this.name = 'UserCancelledError';
  }
}
