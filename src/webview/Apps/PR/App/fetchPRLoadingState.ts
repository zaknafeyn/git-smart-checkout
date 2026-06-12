import { WebviewCommand } from '../../../types/commands';

export function fetchPRLoadingReducer(isLoading: boolean, command: WebviewCommand): boolean {
  switch (command) {
    case WebviewCommand.FETCH_PR:
      return true;
    case WebviewCommand.SHOW_PR_DATA:
    case WebviewCommand.FETCH_PR_ERROR:
    case WebviewCommand.CANCEL_PR_CLONE:
      return false;
    default:
      return isLoading;
  }
}
