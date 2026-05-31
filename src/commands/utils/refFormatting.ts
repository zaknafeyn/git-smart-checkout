import { formatDistanceToNow } from 'date-fns';
import { IGitRef } from '../../common/git/types';

export const ICON_BRANCH = '$(source-control)';
export const ICON_REMOTE_BRANCH = '$(cloud)';
export const ICON_TAG = '$(tag)';
export const ICON_PLUS = '$(plus)';
export const ICON_FOLDER = '$(folder)';
export const ICON_ARROW_UP = '↑';
export const ICON_ARROW_DOWN = '↓';
export const ICON_STAR_FILLED = '$(star-full)';

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

/**
 * Label for a ref with a leading star when it's preferred. The star stays
 * visible at all times (unlike the inline quick-pick button, which only shows
 * on hover), so preferred refs remain marked when the row is not active.
 */
export const getRefLabelWithStar = (ref: IGitRef, isPreferred: boolean) => {
  const label = getRefLabel(ref);
  return isPreferred ? `${ICON_STAR_FILLED} ${label}` : label;
};

export const getRefDescription = (ref: IGitRef) => {
  const formattedDateDistance = ref.committerDate
    ? formatDistanceToNow(Number(ref.committerDate) * 1000, { addSuffix: true })
    : null;
  const upstream = ref.parsedUpstreamTrack
    ? `${ICON_ARROW_UP}${ref.parsedUpstreamTrack[0]} ${ICON_ARROW_DOWN}${ref.parsedUpstreamTrack[1]}`
    : null;

  return [upstream, formattedDateDistance]
    .filter((part): part is string => !!part && part.length > 0)
    .join(' • ');
};

export const getRefDetails = (ref: IGitRef) => {
  return [ref.authorName, ref.hash, ref.comment]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' • ');
};
