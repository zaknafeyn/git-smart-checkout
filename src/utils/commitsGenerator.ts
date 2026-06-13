export interface CommitGeneratorItem {
  sha: string;
  current: number;
  total: number;
}

export class CommitsGenerator {
  constructor(private commits: readonly string[]) {}

  async *[Symbol.asyncIterator]() {
    for (const [index, sha] of this.commits.entries()) {
      yield {
        sha,
        current: index + 1,
        total: this.commits.length,
      };
    }
  }
}
