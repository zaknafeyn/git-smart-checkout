// Ambient declaration mirrored from src/webview/types so the root tsconfig
// (which excludes src/webview/**) can type-check renderMarkdown.ts when it is
// pulled in by unit tests. markdown-it-task-lists ships no types of its own.
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface TaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }

  const taskLists: (md: MarkdownIt, options?: TaskListsOptions) => void;
  export default taskLists;
}
