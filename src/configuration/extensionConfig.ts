export const AUTO_STASH_MODE_MANUAL = 'manual';
export const AUTO_STASH_MODE_BRANCH = 'autoStashForBranch';
export const AUTO_STASH_MODE_POP = 'autoStashAndPop';
export const AUTO_STASH_MODE_APPLY = 'autoStashAndApply';

export const autoStashModeConfig = {
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODE_BRANCH,
  AUTO_STASH_MODE_POP,
  AUTO_STASH_MODE_APPLY,
} as const;

export type TAutoStashModeConfig = (typeof autoStashModeConfig)[keyof typeof autoStashModeConfig];

export const AUTO_STASH_MODES = Object.values(autoStashModeConfig);

export interface ExtensionConfig {
  mode: TAutoStashModeConfig;
  refetchBeforeCheckout: boolean;
  showStatusBar: boolean;
  logging: {
    enabled: boolean;
  };
}

export interface IAutoStashMode {
  icon: string;
  label: string;
  briefLabel: string;
  description: string;
}

export const AUTO_STASH_MODES_DETAILS: Record<TAutoStashModeConfig, IAutoStashMode> = {
  [AUTO_STASH_MODE_MANUAL]: {
    icon: '$(gear)',
    label: 'Select mode manually at checkout',
    briefLabel: 'Manual',
    description: '',
  },
  [AUTO_STASH_MODE_BRANCH]: {
    icon: '$(git-branch)',
    label: 'Auto stash in current branch',
    briefLabel: 'Auto stash',
    description: '',
  },
  [AUTO_STASH_MODE_POP]: {
    icon: '$(git-stash-pop)',
    label: 'Auto stash and pop in new branch',
    briefLabel: 'Stash & pop',
    description: '',
  },
  [AUTO_STASH_MODE_APPLY]: {
    icon: '$(git-stash-apply)',
    label: 'Auto stash and apply in new branch',
    briefLabel: 'Stash & apply',
    description: '',
  },
};
