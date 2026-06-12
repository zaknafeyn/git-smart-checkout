export interface WebviewStateApi<State> {
  getState(): State | undefined;
  setState(state: State): State;
}

export function readWebviewState<State>(
  api: WebviewStateApi<State>,
  fallback: State
): State {
  return api.getState() ?? fallback;
}

export function writeWebviewState<State>(
  api: WebviewStateApi<State>,
  state: State
): void {
  api.setState(state);
}
