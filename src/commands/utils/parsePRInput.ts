export const INVALID_PR_INPUT_MESSAGE =
  'Invalid input. Enter a PR number (e.g. 123 or #123) or a GitHub PR URL.';

export function parsePRInput(input: string): number | null {
  const num = input.trim().match(/^#?(\d+)$/);
  if (num) {
    return parseInt(num[1], 10);
  }

  const url = input.trim().match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (url) {
    return parseInt(url[1], 10);
  }

  return null;
}
