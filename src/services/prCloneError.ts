export class PrCloneReportedError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = 'PrCloneReportedError';
  }
}
