import { WebviewCommand } from '../../../types/commands';

export const FETCH_PR_LOADING_TIMEOUT = 'fetchPRLoadingTimeout';

export type FetchPRLoadingAction = WebviewCommand | typeof FETCH_PR_LOADING_TIMEOUT;

export function fetchPRLoadingReducer(
  isLoading: boolean,
  action: FetchPRLoadingAction
): boolean {
  switch (action) {
    case WebviewCommand.FETCH_PR:
      return true;
    case WebviewCommand.SHOW_PR_DATA:
    case WebviewCommand.FETCH_PR_ERROR:
    case WebviewCommand.CANCEL_PR_CLONE:
    case FETCH_PR_LOADING_TIMEOUT:
      return false;
    default:
      return isLoading;
  }
}
