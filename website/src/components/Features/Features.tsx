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
    command: 'Git Smart Checkout: Checkout to... (With Stash)',
    color: 'blue',
  },
  {
    icon: '📥',
    title: 'Pull with Stash',
    description:
      'Pull the latest changes from remote without losing your local work. Changes are stashed before the pull and restored automatically after.',
    command: 'Git Smart Checkout: Pull (With Stash)',
    color: 'green',
  },
  {
    icon: '🔃',
    title: 'Pull with Rebase',
    description:
      'Pull with rebase while preserving local changes. The extension stashes your work, rebases onto the remote branch, and restores your changes afterward.',
    command: 'Git Smart Checkout: Pull (Rebase With Stash)',
    color: 'orange',
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
    command: 'Git Smart Checkout: Checkout previous branch (With Stash)',
    color: 'purple',
  },
  {
    icon: '🍒',
    title: 'GitHub PR Clone',
    description:
      'Cherry-pick individual commits from any GitHub PR into a new branch and open a new pull request — without merging the entire PR.',
    command: 'Git Smart Checkout: Clone pull request...',
    tag: 'Beta',
    color: 'orange',
  },
  {
    icon: '🔎',
    title: 'PR Review in Worktree',
    description:
      'Open a GitHub PR in an isolated linked worktree, track its review metadata, and remove the review worktree later with dirty-state stash handling.',
    command: 'Git Smart Checkout: PR Review in Worktree',
    tag: 'New',
    color: 'purple',
  },
  {
    icon: '🏷️',
    title: 'Tag from Template',
    description:
      'Generate version tags from a configurable template. Read values from package.json, extract ticket IDs from branch names, and auto-increment to avoid collisions.',
    command: 'Git Smart Checkout: Create Tag from Template',
    color: 'blue',
  },
  {
    icon: '🌲',
    title: 'Worktree Workflows',
    description:
      'Create a new branch worktree, carry local changes with your stash mode, copy staged or WIP changes between worktrees, move WIP back, and remove worktrees safely.',
    command: 'Git Smart Checkout: Move to new worktree',
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
    icon: '📊',
    title: 'Status Bar Integration',
    description:
      'See your current stash mode at a glance in the VS Code status bar. Click once to switch modes — no need to open settings.',
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
