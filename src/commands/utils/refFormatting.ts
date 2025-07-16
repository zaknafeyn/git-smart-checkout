import { formatDistanceToNow } from 'date-fns';
import { IGitRef } from '../../common/git/types';

export const ICON_BRANCH = '$(source-control)';
export const ICON_REMOTE_BRANCH = '$(cloud)';
export const ICON_TAG = '$(tag)';
export const ICON_PLUS = '$(plus)';
export const ICON_ARROW_UP = '↑';
export const ICON_ARROW_DOWN = '↓';

const getRefIcon = (ref: IGitRef) => {
  switch (true) {
    case ref.isTag:
      return ICON_TAG;
    case !!ref.remote:
      return ICON_REMOTE_BRANCH;
    default:
      return ICON_BRANCH;
  }
};

export const getRefLabel = (ref: IGitRef) => {
  const result = [getRefIcon(ref), ref.fullName];

  return result.join(' ');
};

export const getRefDescription = (ref: IGitRef) => {
  const formattedDateDistance = ref.committerDate
    ? formatDistanceToNow(Number(ref.committerDate) * 1000, { addSuffix: true })
    : null;
  const upstream = ref.parsedUpstreamTrack
    ? `${ICON_ARROW_UP}${ref.parsedUpstreamTrack[0]} ${ICON_ARROW_DOWN}${ref.parsedUpstreamTrack[1]}`
    : null;
  const result = [
    ...(upstream ? [upstream, '•'] : []),
    ...(formattedDateDistance ? [formattedDateDistance] : []),
  ];

  return result.join(' ');
};

export const getRefDetails = (ref: IGitRef) => {
  const result = [ref.authorName, ref.hash, ref.comment];

  return result.join(' • ');
};
