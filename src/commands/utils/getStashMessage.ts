import { format } from 'date-fns';
import { AUTO_STASH_PREFIX } from '../checkoutToCommand/constants';

export const getStashMessage = (branch: string, addDate = false) => {
  if (addDate) {
    return `${AUTO_STASH_PREFIX}-${branch}-${format(Date.now(), 'yyyy-MM-ddThh:mm:ss')}`;
  }

  return `${AUTO_STASH_PREFIX}-${branch}`;
};
