import { format } from 'date-fns';
import { AUTO_STASH_PREFIX } from '../checkoutToCommand/constants';

export const getStashMessage = (branch: string, addDate = false, now: Date | number = Date.now()) => {
  if (addDate) {
    return `${AUTO_STASH_PREFIX}-${branch}-${format(now, "yyyy-MM-dd'T'HH:mm:ss")}`;
  }

  return `${AUTO_STASH_PREFIX}-${branch}`;
};
