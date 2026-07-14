import type { ReactNode } from 'react';

import { FeatureCard, type FeatureCardTone } from '../FeatureCard/FeatureCard';
import styles from './Features.module.css';

interface Feature {
  icon: string;
  title: string;
  description: ReactNode;
  command?: string;
  tag?: string;
  color: FeatureCardTone;
}

const features: Feature[] = [
  {
    icon: '🔄',
    title: 'Smart Branch Checkout',
    description:
      'Switch branches without worrying about uncommitted changes. Choose your stash strategy once or per checkout — the extension handles everything else.',
    command: 'GSC: Checkout to... (With Stash)',
    color: 'blue',
  },
  {
    icon: '📥',
    title: 'Pull with Stash',
    description:
      'Pull the latest changes from remote without losing your local work. Changes are stashed before the pull and restored automatically after.',
    command: 'GSC: Pull (With Stash)',
    color: 'green',
  },
  {
    icon: '🔃',
    title: 'Pull with Rebase',
    description:
      'Pull with rebase while preserving local changes. The extension stashes your work, rebases onto the remote branch, and restores your changes afterward.',
    command: 'GSC: Pull (Rebase With Stash)',
    color: 'orange',
  },
  {
    icon: '🔀',
    title: 'Rebase with Stash',
    description:
      'Rebase the current branch onto any other branch, tag, or ref while your local changes are stashed and restored automatically — no need to commit or clean up first.',
    command: 'GSC: Rebase (With Stash)',
    color: 'purple',
  },
  {
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
  },
  {
    icon: '⭐',
    title: 'Preferred Branches',
    description:
      'Star the branches, tags, and remotes you use most — they float to the top of the checkout picker, marked with a star. Toggle a star straight from the picker, no settings file to edit.',
    command: 'GSC: Checkout to... (With Stash)',
    tag: 'New',
    color: 'blue',
  },
  {
    icon: '🍒',
    title: 'GitHub PR Clone',
    description:
      'Cherry-pick individual commits from any GitHub PR into a new branch and open a new pull request — without merging the entire PR. The description preview renders full GitHub-Flavored Markdown and can pre-fill from the repo PR template.',
    command: 'GSC: Clone Pull Request...',
    tag: 'Beta',
    color: 'orange',
  },
  {
    icon: '#️⃣',
    title: 'Checkout by PR Number',
    description:
      "Check out any GitHub pull request's branch by its PR number or URL, with the same auto-stash handling as a regular checkout. No more copying branch names by hand.",
    command: 'GSC: Checkout by PR Number... (With Stash)',
    color: 'orange',
  },
  {
    icon: '🔎',
    title: 'PR Review in Worktree',
    description:
      'Open a GitHub PR in an isolated linked worktree, track its review metadata, and remove the review worktree later with dirty-state stash handling.',
    command: 'GSC: PR Review in Worktree...',
    color: 'purple',
  },
  {
    icon: '🖥️',
    title: 'Worktree Dev Terminal',
    description:
      'Open a new integrated terminal straight in any worktree directory. Pick a project, choose the worktree, and get a shell in the right working directory — no manual navigation.',
    command: 'GSC: Open Worktree Dev Terminal...',
    color: 'blue',
  },
  {
    icon: '🏷️',
    title: 'Tag from Template',
    description:
      'Generate version tags from a configurable template. Read values from package.json, extract ticket IDs from branch names, and auto-increment to avoid collisions.',
    command: 'GSC: Create Tag from Template...',
    color: 'blue',
  },
  {
    icon: '🌿',
    title: 'Branch from Template',
    description:
      'Create and check out a branch from a reusable template. Pull the key and title straight from a Jira ticket, or fill values from package.json, branch-name regex, and custom scripts.',
    command: 'GSC: Create Branch from Template...',
    color: 'green',
  },
  {
    icon: '🌲',
    title: 'Worktree Workflows',
    description:
      'Create a new branch worktree, carry local changes with your stash mode, copy staged or WIP changes between worktrees, move WIP back, and remove several worktrees at once with a single confirmation.',
    command: 'GSC: Move to New Worktree...',
    color: 'green',
  },
  {
    icon: '🛡️',
    title: 'Conflict Prediction',
    description:
      'Before switching branches, the extension detects which files would conflict with your stash. No more surprise merge disasters mid-checkout.',
    color: 'green',
  },
  {
    icon: '📋',
    title: 'Auto-Stash Manager',
    description:
      'Inspect, recover, or remove the stashes Git Smart Checkout creates — see branch, age, file count and a diff preview, then Apply, Pop, or Drop each one with a single click.',
    command: 'GSC: Manage Auto-Stashes...',
    tag: 'New',
    color: 'green',
  },
  {
    icon: '📊',
    title: 'Status Bar Integration',
    description:
      "See your current stash mode at a glance, then click the status bar item for a quick-actions menu — checkout, pull/rebase, worktree commands, clone PR, and settings, each gated to your repo's state.",
    command: 'GSC: Quick Actions...',
    color: 'purple',
  },
];

export function Features() {
  return (
    <section id="features" className={styles.section}>
      <div className="container">
        <div className={styles.header}>
          <span className={styles.eyebrow}>What's included</span>
          <h2 className={styles.title}>Everything you need for seamless branch switching</h2>
          <p className={styles.subtitle}>
            Powerful features that eliminate the friction between you and your Git workflow.
          </p>
        </div>

        <div className={styles.grid}>
          {features.map((f) => (
            <FeatureCard
              key={f.title}
              icon={f.icon}
              title={f.title}
              description={f.description}
              command={f.command}
              tag={f.tag}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
