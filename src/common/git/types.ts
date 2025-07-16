export type TUpstreamTrack = [ahead: number, behind: number] | undefined;

export interface IGitRef {
  authorName: string;
  remote?: string;
  name: string;
  fullName: string;
  hash?: string;
  comment?: string;
  isTag?: boolean;
  committerDate?: string;
  upstreamTrack?: string;
  parsedUpstreamTrack?: TUpstreamTrack;
}
