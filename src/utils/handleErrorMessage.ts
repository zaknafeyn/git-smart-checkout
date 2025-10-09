
export const handleErrorMessage = (error: unknown, checkMessage = 'No local changes to save', message = 'No local changes to stash.', defaultMessage = 'Failed to stash the current changes.') => {
  if (error instanceof Error) {
    if (error.message === checkMessage) {
      throw new Error(message);
    } 

    throw new Error(defaultMessage);
  } 
  
  throw new Error(defaultMessage);
};
