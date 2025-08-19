import { GitExecutor } from '../common/git/gitExecutor';

export interface CommitGeneratorItem {
  sha: string;
  timestamp: number;
  current: number;
  total: number;
}

export class CommitsGenerator {
  constructor(
    private git: GitExecutor,
    private commits: string[]
  ) {}

  async *[Symbol.asyncIterator]() {
    // Sort commits by creation date to ensure proper chronological order
    const commitDetails = await Promise.all(
      this.commits.map(async (sha) => this.git.getCommitTimestamp(sha))
    );

    const sortedCommits: CommitGeneratorItem[] = commitDetails
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((commit, i, arr) => ({
        sha: commit.sha,
        timestamp: commit.timestamp,
        current: i + 1,
        total: arr.length,
      }));

    for (const item of sortedCommits) {
      yield item;
    }
  }
}
