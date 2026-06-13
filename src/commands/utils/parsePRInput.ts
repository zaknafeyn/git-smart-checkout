export const INVALID_PR_INPUT_MESSAGE =
  'Invalid input. Enter a PR number (e.g. 123 or #123) or a GitHub PR URL.';

export interface ParsedPRInput {
  prNumber: number;
  owner?: string;
  repo?: string;
}

export function parsePRInput(input: string): ParsedPRInput | null {
  const trimmedInput = input.trim();
  const num = trimmedInput.match(/^#?([1-9]\d*)$/);
  if (num) {
    const prNumber = Number(num[1]);
    return Number.isSafeInteger(prNumber) ? { prNumber } : null;
  }

  try {
    const url = new URL(trimmedInput);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') {
      return null;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (
      pathParts.length >= 4 &&
      pathParts[2] === 'pull' &&
      /^[1-9]\d*$/.test(pathParts[3])
    ) {
      const prNumber = Number(pathParts[3]);
      if (!Number.isSafeInteger(prNumber)) {
        return null;
      }

      return {
        prNumber,
        owner: pathParts[0],
        repo: pathParts[1],
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function getRepositoryMismatchMessage(
  input: ParsedPRInput,
  currentRepository: { owner: string; repo: string }
): string | undefined {
  if (!input.owner || !input.repo) {
    return undefined;
  }

  const isSameRepository =
    input.owner.toLowerCase() === currentRepository.owner.toLowerCase() &&
    input.repo.toLowerCase() === currentRepository.repo.toLowerCase();

  if (isSameRepository) {
    return undefined;
  }

  return `This PR URL belongs to ${input.owner}/${input.repo}, but the current repository is ${currentRepository.owner}/${currentRepository.repo}.`;
}
