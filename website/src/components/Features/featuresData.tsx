import type { ReactNode } from 'react';

import type { FeatureCardTone } from '../FeatureCard/FeatureCard';

export interface FeatureMedia {
  /** 'video' = self-hosted mp4 (primary); 'youtube' = YouTube video id */
  kind: 'video' | 'youtube';
  /** kind 'video': site-absolute path, e.g. '/videos/smart-checkout.mp4' (file in website/public/videos/).
   *  kind 'youtube': the 11-char video id only. */
  src: string;
  poster?: string; // optional poster image for kind 'video'
}

export interface FeatureDetails {
  longDescription: ReactNode; // 2–4 sentences, may include <kbd>/<code>
  highlights: string[]; // 3–6 plain-string bullets
  commands?: string[]; // exact palette titles, e.g. 'GSC: Checkout to... (With Stash)'
  settings?: string[]; // exact ids, e.g. 'git-smart-checkout.recentBranchCount'
  docsUrl?: string; // ONLY if the file exists in docs/ (allowed list in Section 5)
  media?: FeatureMedia; // omit => "Demo video coming soon" placeholder
}

export interface Feature {
  id: string; // unique kebab-case slug; used as React key
  icon: string;
  title: string;
  description: ReactNode; // short card copy — unchanged from today
  command?: string;
  tag?: string;
  color: FeatureCardTone; // kept but intentionally NOT forwarded to FeatureCard in the main grid (today's behavior) — do not "fix" this
  details: FeatureDetails; // required — every main-grid card is clickable
}

const DOCS_BASE = 'https://github.com/zaknafeyn/git-smart-checkout/blob/main/docs/';

export const features: Feature[] = [
  {
    id: 'smart-checkout',
    icon: '🔄',
    title: 'Smart Branch Checkout',
    description:
      'Switch branches without worrying about uncommitted changes. Choose your stash strategy once or per checkout — the extension handles everything else.',
    command: 'GSC: Checkout to... (With Stash)',
    color: 'blue',
    details: {
      longDescription:
        'Pick a stash strategy globally or per checkout, then switch branches with your working tree carried along automatically. Conflict prediction runs before the switch so you never get a mid-checkout surprise.',
      highlights: [
        'Stash-mode choice per checkout or set globally in settings',
        'Inline branch actions in the picker — delete, rename, or push a branch without leaving it',
        '"Recent" section ranked by frequency and recency, sized by recentBranchCount (0 disables it)',
        'Starred preferred branches, tags, and remotes float to the top',
        'Conflict prediction warns about files that would clash with the stash before you switch',
      ],
      commands: ['GSC: Checkout to... (With Stash)', 'GSC: Switch Mode...'],
      settings: ['git-smart-checkout.recentBranchCount', 'git-smart-checkout.useFastBranchList'],
      docsUrl: `${DOCS_BASE}checkout-with-stash.md`,
    },
  },
  {
    id: 'pull-with-stash',
    icon: '📥',
    title: 'Pull with Stash',
    description:
      'Pull the latest changes from remote without losing your local work. Changes are stashed before the pull and restored automatically after.',
    command: 'GSC: Pull (With Stash)',
    color: 'green',
    details: {
      longDescription:
        'Your local changes are stashed before the pull, then restored the moment it completes — no manual stash juggling required.',
      highlights: [
        'Stash → pull → restore in a single command',
        'Respects the resolved remote, including a configured defaultRemote',
        'A conflicting restore hands off to guided Stash-Conflict Rescue',
      ],
      commands: ['GSC: Pull (With Stash)'],
      docsUrl: `${DOCS_BASE}pull-with-stash.md`,
    },
  },
  {
    id: 'pull-with-rebase',
    icon: '🔃',
    title: 'Pull with Rebase',
    description:
      'Pull with rebase while preserving local changes. The extension stashes your work, rebases onto the remote branch, and restores your changes afterward.',
    command: 'GSC: Pull (Rebase With Stash)',
    color: 'orange',
    details: {
      longDescription:
        'Same safe stash-and-restore flow as Pull with Stash, but rebases onto the remote branch instead of merging — so history stays linear without ever committing your work in progress.',
      highlights: [
        'Stash, rebase onto the remote branch, restore — one command',
        'Keeps history linear without committing WIP just to rebase',
        'Same stash-mode and conflict handling as every other stash-carrying command',
      ],
      commands: ['GSC: Pull (Rebase With Stash)'],
      docsUrl: `${DOCS_BASE}pull-rebase-with-stash.md`,
    },
  },
  {
    id: 'rebase-with-stash',
    icon: '🔀',
    title: 'Rebase with Stash',
    description:
      'Rebase the current branch onto any other branch, tag, or ref while your local changes are stashed and restored automatically — no need to commit or clean up first.',
    command: 'GSC: Rebase (With Stash)',
    color: 'purple',
    details: {
      longDescription:
        'Rebase onto any branch, tag, or ref you pick from the same picker used for checkout — your local changes are stashed first and restored once the rebase lands.',
      highlights: [
        'Rebase onto any branch, tag, or arbitrary ref',
        'Auto-stash before, auto-restore after',
        'Conflicts during the rebase or the restore are surfaced clearly',
      ],
      commands: ['GSC: Rebase (With Stash)'],
      docsUrl: `${DOCS_BASE}rebase-with-stash.md`,
    },
  },
  {
    id: 'checkout-previous',
    icon: '⬅️',
    title: 'Checkout Previous Branch',
    description: (
      <>
        Instantly jump back to the branch you were on before, with the same auto-stash
        magic. Think of it as <kbd>Ctrl + Z</kbd> for branch switching.
      </>
    ),
    command: 'GSC: Checkout Previous Branch (With Stash)',
    color: 'purple',
    details: {
      longDescription:
        'One keystroke bounces you between your current branch and the previous one, with the same stash mode handling every other checkout command uses.',
      highlights: [
        'One-keystroke bounce between the last two branches you worked on',
        'Same stash-mode handling as a regular checkout',
      ],
      commands: ['GSC: Checkout Previous Branch (With Stash)'],
      docsUrl: `${DOCS_BASE}checkout-previous-branch-with-stash.md`,
    },
  },
  {
    id: 'preferred-branches',
    icon: '⭐',
    title: 'Preferred Branches',
    description:
      'Star the branches, tags, and remotes you use most — they float to the top of the checkout picker, marked with a star. Toggle a star straight from the picker, no settings file to edit.',
    command: 'GSC: Checkout to... (With Stash)',
    tag: 'New',
    color: 'blue',
    details: {
      longDescription:
        'Star the branches, tags, and remote refs you switch to most often, and they always show up first in the checkout picker — no configuration file to hand-edit.',
      highlights: [
        'Star or unstar any branch, tag, or remote ref straight from the picker',
        'Starred refs float to the top, marked with a star',
      ],
      commands: ['GSC: Checkout to... (With Stash)'],
      docsUrl: `${DOCS_BASE}checkout-with-stash.md`,
    },
  },
  {
    id: 'delete-merged-branches',
    icon: '🧹',
    title: 'Delete Merged Branches',
    description:
      'Sweep away branches already merged or whose upstream is gone, in one multi-select pass.',
    command: 'GSC: Delete Merged Branches...',
    tag: 'New',
    color: 'green',
    details: {
      longDescription:
        'Clear out stale local branches in one pass — the picker groups branches that are already merged separately from ones whose upstream disappeared, so you always know why a branch is on the list.',
      highlights: [
        'Grouped picker: merged branches vs. gone-upstream branches',
        'Protects the current branch and the repo\'s default branch',
        'Shows an undo hint right after deletion',
        'Reachable straight from Quick Actions',
      ],
      commands: ['GSC: Delete Merged Branches...'],
    },
  },
  {
    id: 'pr-clone',
    icon: '🍒',
    title: 'GitHub PR Clone',
    description:
      'Cherry-pick individual commits from any GitHub PR into a new branch and open a new pull request — without merging the entire PR. The description preview renders full GitHub-Flavored Markdown and can pre-fill from the repo PR template.',
    command: 'GSC: Clone Pull Request...',
    tag: 'Beta',
    color: 'orange',
    details: {
      longDescription:
        'Cherry-pick just the commits you want from any GitHub PR into a brand-new branch, then open a fresh pull request with a GitHub-Flavored Markdown preview that can pre-fill from the repo\'s PR template.',
      highlights: [
        'Pick exactly which commits to cherry-pick from the source PR',
        'Full GFM description preview, pre-filled from the repo PR template',
        'Configurable checkoutAfterClone behavior: ask, always, or never',
        'Set a branch prefix and a default target branch',
        'Cancel mid-clone, or resolve conflicts and continue',
      ],
      commands: ['GSC: Clone Pull Request...'],
      settings: [
        'git-smart-checkout.prClone.checkoutAfterClone',
        'git-smart-checkout.defaultTargetBranch',
        'git-smart-checkout.prBranchPrefix',
      ],
      docsUrl: `${DOCS_BASE}github-pr-clone.md`,
    },
  },
  {
    id: 'checkout-by-pr',
    icon: '#️⃣',
    title: 'Checkout by PR Number',
    description:
      "Check out any GitHub pull request's branch by its PR number or URL, with the same auto-stash handling as a regular checkout. No more copying branch names by hand.",
    command: 'GSC: Checkout by PR Number... (With Stash)',
    color: 'orange',
    details: {
      longDescription:
        'Paste a PR number or URL and land straight on that branch — the extension fetches it for you, with the same stash handling as a regular checkout.',
      highlights: [
        'Accepts a bare PR number or a full GitHub URL',
        'Auto-stash handling identical to a regular checkout',
        'Aware of GitHub Enterprise hosts and multi-remote resolution',
      ],
      commands: ['GSC: Checkout by PR Number... (With Stash)'],
      docsUrl: `${DOCS_BASE}checkout-by-pr-number-with-stash.md`,
    },
  },
  {
    id: 'multi-remote',
    icon: '🛰️',
    title: 'Multi-Remote Support',
    description:
      'Fork-friendly — the right remote is picked automatically for fetch and push, or pin one with defaultRemote.',
    color: 'blue',
    details: {
      longDescription:
        'Working across a fork and upstream? The extension resolves the right remote for every fetch and push automatically, or you can pin one explicitly with defaultRemote.',
      highlights: [
        'Resolution chain: branch upstream → defaultRemote → the repo\'s only remote → a picker',
        'Picker choice is remembered per repo for the session',
        'Threads through pulls, checkout by PR number, and tag push',
      ],
      settings: ['git-smart-checkout.defaultRemote'],
    },
  },
  {
    id: 'pr-review-worktree',
    icon: '🔎',
    title: 'PR Review in Worktree',
    description:
      'Open a GitHub PR in an isolated linked worktree, track its review metadata, and remove the review worktree later with dirty-state stash handling.',
    command: 'GSC: PR Review in Worktree...',
    color: 'purple',
    details: {
      longDescription:
        'Review a GitHub PR in its own linked worktree so it never disturbs your main working tree. Review metadata is tracked automatically, and removal handles any leftover dirty state.',
      highlights: [
        'Isolated linked worktree per PR review',
        'Review metadata tracked across sessions',
        'Removal handles dirty-state stashing',
        'See also Review PR by Number for a faster entry point',
      ],
      commands: [
        'GSC: PR Review in Worktree...',
        'GSC: Remove PR Review in Worktree...',
      ],
      settings: ['git-smart-checkout.defaultWorktreeDirectory'],
      docsUrl: `${DOCS_BASE}pr-review-in-worktree.md`,
    },
  },
  {
    id: 'review-pr-by-number',
    icon: '👀',
    title: 'Review PR by Number',
    description:
      'Type a PR number or URL and land in an isolated review worktree in one step.',
    command: 'GSC: Review PR by Number...',
    tag: 'New',
    color: 'orange',
    details: {
      longDescription:
        'Skip the PR list picker entirely — type a PR number or paste a URL and go straight into an isolated review worktree.',
      highlights: [
        'Skips the PR list picker for a faster entry point',
        'Works with GitHub Enterprise Server',
        'The review worktree is tracked for later removal',
      ],
      commands: ['GSC: Review PR by Number...'],
      docsUrl: `${DOCS_BASE}pr-review-in-worktree.md`,
    },
  },
  {
    id: 'github-enterprise',
    icon: '🏢',
    title: 'GitHub Enterprise',
    description: 'All PR features work against GitHub Enterprise Server, not just github.com.',
    color: 'purple',
    details: {
      longDescription:
        'Every PR-related feature works the same way against a GitHub Enterprise Server instance as it does on github.com — the extension detects which host a repo belongs to and talks to the right API.',
      highlights: [
        'Host detection matches the repo remote to your configured base URL',
        'PR Clone, Checkout by PR Number, PR Review in Worktree, and Review PR by Number all use <baseUrl>/api/v3',
        'Web and compare links are built on the Enterprise host',
      ],
      settings: ['git-smart-checkout.githubEnterpriseBaseUrl'],
    },
  },
  {
    id: 'worktree-terminal',
    icon: '🖥️',
    title: 'Worktree Dev Terminal',
    description:
      'Open a new integrated terminal straight in any worktree directory. Pick a project, choose the worktree, and get a shell in the right working directory — no manual navigation.',
    command: 'GSC: Open Worktree Dev Terminal...',
    color: 'blue',
    details: {
      longDescription:
        'Pick a project, choose a worktree, and get a shell already sitting in the right directory — no cd, no hunting through folders.',
      highlights: [
        'Pick a project, then a worktree, then get a shell in the right cwd',
      ],
      commands: ['GSC: Open Worktree Dev Terminal...'],
      docsUrl: `${DOCS_BASE}open-worktree-dev-terminal.md`,
    },
  },
  {
    id: 'tag-template',
    icon: '🏷️',
    title: 'Tag from Template',
    description:
      'Generate version tags from a configurable template. Read values from package.json, extract ticket IDs from branch names, and auto-increment to avoid collisions.',
    command: 'GSC: Create Tag from Template...',
    color: 'blue',
    details: {
      longDescription:
        'Build version tags from a reusable template — pull tokens from package.json or a branch-name regex, auto-increment to dodge collisions, and preview the result before creating anything.',
      highlights: [
        'Tokens sourced from package.json or branch-name regex',
        'Auto-increment avoids tag collisions',
        'Optional push via the resolved remote',
        'Dry-run the result first with Template Preview',
      ],
      commands: [
        'GSC: Create Tag from Template...',
        'GSC: Preview Branch/Tag Template...',
      ],
      docsUrl: `${DOCS_BASE}create-tag-from-template.md`,
    },
  },
  {
    id: 'branch-template',
    icon: '🌿',
    title: 'Branch from Template',
    description:
      'Create and check out a branch from a reusable template. Pull the key and title straight from a Jira ticket, or fill values from package.json, branch-name regex, and custom scripts.',
    command: 'GSC: Create Branch from Template...',
    color: 'green',
    details: {
      longDescription:
        'Generate a branch name from a template populated by a Jira ticket\'s key and title, package.json values, a branch-name regex, or a custom script — then preview it before creating anything.',
      highlights: [
        'Jira key/title resolvers, with a guided Init Jira setup and the token in Secret Storage',
        'package.json, regex, and custom-script resolvers',
        'Dry-run the result first with Template Preview',
      ],
      commands: [
        'GSC: Create Branch from Template...',
        'GSC: Init Jira...',
        'GSC: Set Jira Token...',
      ],
      docsUrl: `${DOCS_BASE}create-branch-from-template.md`,
    },
  },
  {
    id: 'template-preview',
    icon: '🧪',
    title: 'Branch/Tag Template Preview',
    description:
      'Dry-run your branch and tag templates — see exactly what each resolves to before creating anything.',
    command: 'GSC: Preview Branch/Tag Template...',
    color: 'blue',
    details: {
      longDescription:
        'See exactly what a branch or tag template resolves to before it touches your repo — every resolver runs against your current context, and the output is shown for review only.',
      highlights: [
        'Shows resolver output — package.json, Jira, regex, scripts — without touching the repo',
        'Great for debugging template configuration before you commit to it',
      ],
      commands: ['GSC: Preview Branch/Tag Template...'],
      docsUrl: `${DOCS_BASE}create-branch-from-template.md`,
    },
  },
  {
    id: 'worktree-workflows',
    icon: '🌲',
    title: 'Worktree Workflows',
    description:
      'Create a new branch worktree, carry local changes with your stash mode, copy staged or WIP changes between worktrees, move WIP back, and remove several worktrees at once with a single confirmation.',
    command: 'GSC: Move to New Worktree...',
    color: 'green',
    details: {
      longDescription:
        'A full toolkit for working across worktrees: spin up a new one and carry your WIP with it, copy staged or WIP changes between worktrees on demand, move WIP back to where you started, and clear out several worktrees at once.',
      highlights: [
        'Move to a new worktree, carrying WIP via your stash mode',
        'Copy staged or WIP changes between worktrees',
        'Move WIP changes back to the original worktree',
        'Remove several worktrees at once with a single confirmation',
        'New worktrees can run setup hooks automatically on creation',
      ],
      commands: [
        'GSC: Move to New Worktree...',
        'GSC: Copy Staged Changes to Worktree...',
        'GSC: Copy WIP Changes to Worktree...',
        'GSC: Move WIP from Worktree...',
        'GSC: Remove Multiple Worktrees...',
      ],
      settings: ['git-smart-checkout.defaultWorktreeDirectory'],
      docsUrl: `${DOCS_BASE}copy-changes-to-worktree.md`,
    },
  },
  {
    id: 'worktrees-explorer',
    icon: '🗂️',
    title: 'Worktrees Explorer',
    description:
      'A dedicated Worktrees view showing every worktree across your open repos with live status.',
    tag: 'New',
    color: 'purple',
    details: {
      longDescription:
        'A dedicated view in the activity bar lists every worktree across your open repositories, with live status badges and one-click actions for the things you do most.',
      highlights: [
        'Dirty, ahead/behind, and PR-review status badges per worktree',
        'Inline actions: Open in New Window, Dev Terminal, Copy WIP Here, Remove',
        'Context menu: Add to Workspace, Copy Path, Reveal in Finder/Explorer',
      ],
    },
  },
  {
    id: 'worktree-setup-hooks',
    icon: '🪝',
    title: 'Post-Worktree Setup Hooks',
    description:
      'New worktrees arrive ready to work — copy .env-style ignored files in and run your install command automatically.',
    tag: 'New',
    color: 'orange',
    details: {
      longDescription:
        'Every new worktree can run a setup step automatically — copying over untracked config files and running whatever install or bootstrap command your project needs, so you\'re never left staring at a half-configured checkout.',
      highlights: [
        'Glob-based copy of untracked/ignored files, like .env',
        'Runs a shell command after worktree creation',
        'Opt-in separately for PR-clone worktrees',
        'Workspace-provided values require explicit consent before running',
      ],
      settings: [
        'git-smart-checkout.worktreeSetup.copyFiles',
        'git-smart-checkout.worktreeSetup.command',
        'git-smart-checkout.worktreeSetup.applyToPrCloneWorktrees',
      ],
    },
  },
  {
    id: 'conflict-prediction',
    icon: '🛡️',
    title: 'Conflict Prediction',
    description:
      'Before switching branches, the extension detects which files would conflict with your stash. No more surprise merge disasters mid-checkout.',
    color: 'green',
    details: {
      longDescription:
        'Before any checkout carries your stash across, the extension checks which files would actually conflict — so you find out before the switch, not in the middle of it.',
      highlights: [
        'Detects conflicting files before the checkout happens',
        'Feeds directly into Stash-Conflict Rescue if a conflict does slip through',
      ],
      docsUrl: `${DOCS_BASE}checkout-with-stash.md`,
    },
  },
  {
    id: 'stash-rescue',
    icon: '🚑',
    title: 'Stash-Conflict Rescue',
    description:
      'When restoring a stash conflicts, get guided rescue actions instead of a cryptic Git error.',
    tag: 'New',
    color: 'green',
    details: {
      longDescription:
        'If restoring an auto-stash ever conflicts, you get clear reporting on exactly what clashed and a guided set of actions to resolve or recover — never a raw Git error to decode on your own.',
      highlights: [
        'Clear reporting on exactly what conflicted',
        'Guided resolve/recover choices instead of a raw Git error',
        'Your changes always survive safely in the auto-stash while you decide',
        'Pairs with Conflict Prediction and the Auto-Stash Manager',
      ],
    },
  },
  {
    id: 'auto-stash-manager',
    icon: '📋',
    title: 'Auto-Stash Manager',
    description:
      'Inspect, recover, or remove the stashes Git Smart Checkout creates — see branch, age, file count and a diff preview, then Apply, Pop, or Drop each one with a single click.',
    command: 'GSC: Manage Auto-Stashes...',
    tag: 'New',
    color: 'green',
    details: {
      longDescription:
        'Every auto-stash the extension creates is inspectable and recoverable — see the branch it came from, its age, file count, and a diff preview, then Apply, Pop, or Drop it with a single click.',
      highlights: [
        'Branch, age, file-count, and diff preview per stash',
        'Apply, Pop, or Drop with one click',
        'A safety net for every stash the extension ever creates',
      ],
      commands: ['GSC: Manage Auto-Stashes...'],
      docsUrl: `${DOCS_BASE}manage-auto-stashes.md`,
    },
  },
  {
    id: 'status-bar',
    icon: '📊',
    title: 'Status Bar Integration',
    description:
      "See your current stash mode at a glance, then click the status bar item for a quick-actions menu — checkout, pull/rebase, worktree commands, clone PR, and settings, each gated to your repo's state.",
    command: 'GSC: Quick Actions...',
    color: 'purple',
    details: {
      longDescription:
        'The status bar always shows your current stash mode at a glance. Click it to open a quick-actions menu covering checkout, pull/rebase, worktree commands, PR clone, and settings — each entry gated to what makes sense for your repo\'s current state.',
      highlights: [
        'Current stash mode visible at a glance',
        'Quick Actions menu gated to repo state',
        'A What\'s New notification appears after updates',
        'Hide the status bar item entirely if you prefer',
      ],
      commands: ['GSC: Quick Actions...', 'GSC: Open Settings'],
      settings: ['git-smart-checkout.showWhatsNew', 'git-smart-checkout.showStatusBar'],
      docsUrl: `${DOCS_BASE}status-bar-quick-actions.md`,
    },
  },
];
