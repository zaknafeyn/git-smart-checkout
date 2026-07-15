import {
  resolveTagTemplateWithTrace,
  ResolveTemplateOptions,
  ScriptTokenError,
  TagTemplateContext,
  TagTemplateLogger,
  TemplateTokenTrace,
} from './tagTemplateService';

export type BranchTemplateLogger = TagTemplateLogger;

export interface BranchTemplateContext {
  workspaceRoot: string;
  getCurrentBranch: () => Promise<string>;
  branchExists: (branchName: string) => Promise<boolean>;
  jiraKey?: string;
  jiraTitle?: string;
  /**
   * Whether Jira is configured for this workspace. Defaults to true (assume
   * configured) when omitted, matching the create-branch flow which already
   * refuses to run before Jira is configured. The preview command sets this to
   * false explicitly so unresolved Jira tokens render a "needs Jira setup"
   * hint instead of a generic "no issue selected" warning.
   */
  jiraConfigured?: boolean;
  readFile?: TagTemplateContext['readFile'];
  realpath?: TagTemplateContext['realpath'];
  runScript?: TagTemplateContext['runScript'];
  logger: BranchTemplateLogger;
}

export interface ResolvedBranch {
  branch: string;
  recurringValueUsed?: number;
  recurringAttempts: number;
  /** True when the template contained an {r} token (regardless of whether a number was appended). */
  hadRecurringToken: boolean;
}

export interface ResolvedBranchWithTrace extends ResolvedBranch {
  tokens: TemplateTokenTrace[];
}

const JIRA_KEY_TOKEN = '{jira-key}';
const JIRA_TITLE_PREFIX = '{jira-title';

export function branchTemplateNeedsJira(template: string): boolean {
  return template.includes(JIRA_KEY_TOKEN) || template.includes(JIRA_TITLE_PREFIX);
}

export interface JiraTitleFormatOptions {
  limit?: number;
  separator?: string;
}

export function parseJiraTitleTokenArgs(args: string): JiraTitleFormatOptions {
  const parts = args.split(':');
  let limit: number | undefined;
  let separator: string | undefined;

  if (parts[0] !== undefined && parts[0].trim() !== '') {
    const parsed = parseInt(parts[0].trim(), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = parsed;
    }
  }

  if (parts.length > 1 && parts[1] !== undefined && parts[1].length > 0) {
    separator = parts[1];
  }

  return { limit, separator };
}

export function formatJiraTitle(
  title: string,
  options: JiraTitleFormatOptions = {}
): string {
  const sep = options.separator && options.separator.length > 0
    ? options.separator[0]
    : '-';
  const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let text = title.replace(/[^a-zA-Z0-9]+/g, sep);
  text = text.replace(new RegExp(`^${escapedSep}+|${escapedSep}+$`, 'g'), '');
  text = text.replace(new RegExp(`${escapedSep}+`, 'g'), sep);
  text = text.toLowerCase();

  if (options.limit !== undefined && options.limit > 0 && text.length > options.limit) {
    text = text.substring(0, options.limit);
    text = text.replace(new RegExp(`${escapedSep}+$`), '');
  }

  return text;
}

function scanJiraTitleTokens(template: string): Array<{ full: string; args: string; index: number }> {
  const tokens: Array<{ full: string; args: string; index: number }> = [];
  let i = 0;
  while (i < template.length) {
    if (template.substring(i).startsWith(JIRA_TITLE_PREFIX)) {
      let depth = 1;
      let j = i + 1;
      while (j < template.length && depth > 0) {
        j++;
        if (template[j] === '{') {
          depth++;
        } else if (template[j] === '}') {
          depth--;
        }
      }
      if (depth === 0) {
        const full = template.substring(i, j + 1);
        const args = template.substring(i + JIRA_TITLE_PREFIX.length, j);
        tokens.push({ full, args, index: i });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return tokens;
}

function finalizeBranchCasing(branch: string, jiraKey?: string): string {
  const lower = branch.toLowerCase();
  if (!jiraKey) {
    return lower;
  }
  const upperKey = jiraKey.toUpperCase();
  const lowerKey = upperKey.toLowerCase();
  return lower.split(lowerKey).join(upperKey);
}

// resolveBranchTemplateWithTrace is the ONLY place branch templates are actually
// resolved. resolveBranchTemplate (used by the real create-branch flow) and the
// template preview command both call it. Jira tokens are resolved here; {f:...},
// {b:...}, {s:...} and {r:...} tokens are delegated to
// resolveTagTemplateWithTrace — the exact same function the create-tag flow
// uses — so the preview never runs a parallel resolution path.
export async function resolveBranchTemplateWithTrace(
  template: string,
  ctx: BranchTemplateContext,
  options: ResolveTemplateOptions = {}
): Promise<ResolvedBranchWithTrace> {
  ctx.logger.info(`[Create Branch] Template: ${template}`);

  const jiraConfigured = ctx.jiraConfigured !== false;
  const trace: TemplateTokenTrace[] = [];
  let result = template;

  if (result.includes(JIRA_KEY_TOKEN)) {
    const key = (ctx.jiraKey ?? '').toUpperCase();
    if (!key) {
      if (!jiraConfigured) {
        ctx.logger.warn('[Create Branch] Jira key token present but Jira is not configured.');
        trace.push({
          raw: JIRA_KEY_TOKEN,
          value: '',
          error: 'needs Jira setup (run GSC: Init Jira)',
        });
      } else {
        ctx.logger.warn('[Create Branch] Jira key token present but no Jira issue was selected.');
        trace.push({ raw: JIRA_KEY_TOKEN, value: '', error: 'no Jira issue selected' });
      }
    } else {
      trace.push({ raw: JIRA_KEY_TOKEN, value: key });
    }
    result = result.split(JIRA_KEY_TOKEN).join(key);
  }

  const titleTokens = scanJiraTitleTokens(result);
  for (const token of titleTokens) {
    const args = token.args.startsWith(':') ? token.args.substring(1) : token.args;
    const formatOpts = parseJiraTitleTokenArgs(args);
    const title = ctx.jiraTitle ?? '';
    const value = title ? formatJiraTitle(title, formatOpts) : '';
    if (!title) {
      if (!jiraConfigured) {
        ctx.logger.warn('[Create Branch] Jira title token present but Jira is not configured.');
        trace.push({
          raw: token.full,
          value: '',
          error: 'needs Jira setup (run GSC: Init Jira)',
        });
      } else {
        ctx.logger.warn(
          '[Create Branch] Jira title token present but no Jira issue title available.'
        );
        trace.push({ raw: token.full, value: '', error: 'no Jira issue title available' });
      }
    } else {
      trace.push({ raw: token.full, value });
    }
    result = result.replace(token.full, () => value);
  }

  const tagCtx: TagTemplateContext = {
    workspaceRoot: ctx.workspaceRoot,
    getCurrentBranch: ctx.getCurrentBranch,
    tagExists: ctx.branchExists,
    readFile: ctx.readFile,
    realpath: ctx.realpath,
    runScript: ctx.runScript,
    logger: {
      info: (m, d) => ctx.logger.info(m.replace('[Create Tag]', '[Create Branch]'), d),
      warn: (m, d) => ctx.logger.warn(m.replace('[Create Tag]', '[Create Branch]'), d),
      debug: (m, d) => ctx.logger.debug(m.replace('[Create Tag]', '[Create Branch]'), d),
    },
  };

  const resolved = await resolveTagTemplateWithTrace(result, tagCtx, options);

  const branch = finalizeBranchCasing(resolved.tag, ctx.jiraKey);

  return {
    branch,
    recurringValueUsed: resolved.recurringValueUsed,
    recurringAttempts: resolved.recurringAttempts,
    hadRecurringToken: resolved.hadRecurringToken,
    tokens: [...trace, ...resolved.tokens],
  };
}

export async function resolveBranchTemplate(
  template: string,
  ctx: BranchTemplateContext
): Promise<ResolvedBranch> {
  const traced = await resolveBranchTemplateWithTrace(template, ctx, { abortOnScriptError: true });
  const { tokens: _tokens, ...rest } = traced;
  return rest;
}

export { ScriptTokenError };
