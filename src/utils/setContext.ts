import { commands } from 'vscode';
import { EXTENSION_NAME } from '../const';

const setContextKey = async (key: string, value: boolean) => {
  await commands.executeCommand('setContext', key, value);
};

export const setContextShowPRClone = async (value: boolean) => {
  await setContextKey(`${EXTENSION_NAME}.showPrClone`, value);
};

export const setContextShowPRCommits = async (value: boolean) => {
  await setContextKey(`${EXTENSION_NAME}.showPrCommits`, value);
};

export const setContextIsCloning = async (value: boolean) => {
  await setContextKey(`${EXTENSION_NAME}.isCloning`, value);
};

export const setContextIsCherryPickConflict = async (value: boolean) => {
  await setContextKey(`${EXTENSION_NAME}.isConflict`, value);
};
