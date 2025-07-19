import {
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_IGNORE,
} from './constants';

const autoStashMode = {
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_IGNORE,
} as const;

export type TAutoStashMode = (typeof autoStashMode)[keyof typeof autoStashMode];
