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

export const PULL_AFTER_CHECKOUT_OFF = 'off';
export const PULL_AFTER_CHECKOUT_FF_ONLY = 'ffOnly';
export const PULL_AFTER_CHECKOUT_PULL = 'pull';

export type TPullAfterCheckout =
  | typeof PULL_AFTER_CHECKOUT_OFF
  | typeof PULL_AFTER_CHECKOUT_FF_ONLY
  | typeof PULL_AFTER_CHECKOUT_PULL;

export interface PreferredRefsRepo {
  locals: string[];
  remotes: string[];
  tags: string[];
}

export type PreferredRefsMap = Record<string, PreferredRefsRepo>;

export interface JiraConfig {
  domain: string;
  username: string;
  token: string;
  projectKeys: string[];
}

export interface ExtensionConfig {
  mode: TAutoStashModeConfig;
  useFastBranchList: boolean;
  recentBranchCount: number;
  githubEnterpriseBaseUrl: string;
  showWhatsNew: 'minor' | 'always' | 'never';
  showStatusBar: boolean;
  defaultTargetBranch: string;
  defaultWorktreeDirectory: string;
  worktreeSetup: {
    copyFiles: string[];
    command: string;
    applyToPrCloneWorktrees: boolean;
  };
  prBranchPrefix: string;
  useInPlaceCherryPick: boolean;
  pullAfterCheckout: TPullAfterCheckout;
  logging: {
    enabled: boolean;
  };
  telemetry: {
    enabled: boolean;
  };
  preferredRefs?: PreferredRefsMap;
  tagTemplate: string;
  pushTagWithoutConfirmation: boolean;
  tagRemote: string;
  branchTemplate: string;
  jira: JiraConfig;
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
