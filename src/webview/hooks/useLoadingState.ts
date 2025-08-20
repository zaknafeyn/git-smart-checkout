import { useCallback, useEffect, useRef, useState } from 'react';

export type TUseLoadingStateResponse = {
  isLoading: boolean;
  start: () => void;
  finish: () => void;
};

export const useLoadingState = (defaultValue = false): TUseLoadingStateResponse => {
  const [isLoading, setIsLoading] = useState(defaultValue);
  const start = useCallback(() => setIsLoading(true), []);
  const finish = useCallback(() => {
    if (isUnmounting.current) {
      return;
    }
    setIsLoading(false);
  }, []);

  /**
   * This will automatically ignore any calls to finish() if
   * the component is unmounting This is useful for when
   * you want to call finish as the last call to an axio promise
   * E.g.: `myAxiosAPI().catch(ignoreCatch).then(finish);`
   */
  const isUnmounting = useRef(false);
  useEffect(() => {
    return () => {
      isUnmounting.current = true;
    };
  }, []);

  return { isLoading, start, finish };
};
