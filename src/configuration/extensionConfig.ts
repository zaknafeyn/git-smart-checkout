import { AUTO_STASH_AND_APPLY_IN_NEW_BRANCH, AUTO_STASH_AND_POP_IN_NEW_BRANCH, AUTO_STASH_CURRENT_BRANCH, AUTO_STASH_IGNORE } from "../commands/checkoutToCommand/constants";

export const AUTO_STASH_MODE_MANUAL = 'Manual';

const autoStashModeConfig = {
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODE_STASH_CURRENT_BRANCH:  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_MODE_AND_POP_IN_NEW_BRANCH: AUTO_STASH_AND_POP_IN_NEW_BRANCH,
  AUTO_STASH_MODE_AND_APPLY_IN_NEW_BRANCH: AUTO_STASH_AND_APPLY_IN_NEW_BRANCH,
  AUTO_STASH_MODE_IGNORE: AUTO_STASH_IGNORE,
};

export type TAutoStashModeConfig = (typeof autoStashModeConfig)[keyof typeof autoStashModeConfig];

export interface ExtensionConfig {
  
 
  mode: TAutoStashModeConfig
  logging: {
      enabled: boolean;
  };
}
