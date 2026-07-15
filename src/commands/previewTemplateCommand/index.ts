import * as vscode from 'vscode';

import { captureException } from '../../analytics/analytics';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import {
  branchTemplateNeedsJira,
  resolveBranchTemplateWithTrace,
} from '../../services/branchTemplateService';
import {
  createJiraClient,
  fetchJiraIssueByKey,
  isJiraConfigured,
  pickJiraIssue,
} from '../../services/jiraService';
import { ScriptConsentStore } from '../../services/scriptConsentStore';
import { resolveTagTemplateWithTrace, TagTemplateContext } from '../../services/tagTemplateService';
import { BaseCommand } from '../command';
import { extractScriptTokenPaths } from './extractScriptTokenPaths';
import { formatPreviewDocument } from './formatPreviewDocument';

const COPY_RESULT_ACTION = 'Copy result';
const RUN_SCRIPTS_ACTION = 'Run';
const SKIP_SCRIPTS_ACTION = 'Skip';
const NOT_AUTHORIZED_MARKER = 'not authorized';

interface TemplatePick {
  kind: 'branch' | 'tag';
  template: string;
}

export class PreviewTemplateCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService,
    private readonly consentStore: ScriptConsentStore = new ScriptConsentStore()
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const log = (msg: string, data?: unknown) =>
      this.logService.info(`[Preview Template] ${msg}`, data);

    log('Started');

    let git: Awaited<ReturnType<typeof this.getGitExecutor>>;
    try {
      git = await this.getGitExecutor();
    } catch (e) {
      this.logService.error('[Preview Template] Could not initialize Git executor', e);
      await this.showErrorMessage('Current workspace is not a Git repository.');
      return;
    }
    const workspaceRoot = git.repositoryPath;

    const cfg = this.configManager.get();
    const pick = await this.pickTemplate(cfg.branchTemplate, cfg.tagTemplate);
    if (!pick) {
      return;
    }
    const { kind, template } = pick;
    log(`Previewing ${kind} template: ${template}`);

    // Resolve Jira context exactly like the real create-branch flow — prompt
    // for an issue when the template needs one. If Jira isn't configured at
    // all, don't block the preview: let resolveWithTrace surface a
    // "needs Jira setup" hint per-token instead (see implementation guidance).
    let jiraKey: string | undefined;
    let jiraTitle: string | undefined;
    let jiraConfigured = true;

    if (kind === 'branch' && branchTemplateNeedsJira(template)) {
      jiraConfigured = isJiraConfigured(cfg.jira);
      if (jiraConfigured) {
        const issue = await pickJiraIssue(cfg.jira, this.logService);
        if (!issue) {
          return;
        }
        jiraKey = issue.key.toUpperCase();
        jiraTitle = issue.summary;
        if (!jiraTitle) {
          const client = createJiraClient(cfg.jira, this.logService);
          if (client) {
            const fetched = await fetchJiraIssueByKey(client, jiraKey);
            jiraTitle = fetched?.summary ?? '';
          }
        }
      }
    }

    const { runScript } = await this.resolveScriptRunner(template, workspaceRoot);

    const logger = {
      info: (m: string, d?: unknown) => this.logService.info(m, d),
      warn: (m: string, d?: unknown) => this.logService.warn(m, d),
      debug: (m: string, d?: unknown) => this.logService.debug(m, d),
    };

    let result: string;
    let tokens: Array<{ raw: string; value?: string; error?: string }>;

    try {
      if (kind === 'branch') {
        const traced = await resolveBranchTemplateWithTrace(
          template,
          {
            workspaceRoot,
            getCurrentBranch: () => this.safeGetCurrentBranch(git),
            branchExists: (name) => git.branchExist(name),
            jiraKey,
            jiraTitle,
            jiraConfigured,
            runScript: runScript ?? undefined,
            logger,
          },
          { abortOnScriptError: false }
        );
        result = traced.branch;
        tokens = traced.tokens;
      } else {
        const tagCtx: TagTemplateContext = {
          workspaceRoot,
          getCurrentBranch: () => this.safeGetCurrentBranch(git),
          tagExists: (name) => git.tagExists(name),
          runScript: runScript ?? undefined,
          logger,
        };
        const traced = await resolveTagTemplateWithTrace(template, tagCtx, {
          abortOnScriptError: false,
        });
        result = traced.tag;
        tokens = traced.tokens;
      }
    } catch (e) {
      // Only unrecoverable errors reach here (e.g. malformed template causing
      // the recurring-token iteration cap, or an invalid regex construction
      // failure) — resolveWithTrace itself never throws for per-token
      // failures when abortOnScriptError is false. Surface it without a
      // disruptive error toast, per spec: parse errors should still open a
      // preview document rather than fail the command outright.
      captureException(e);
      this.logService.error('[Preview Template] Template resolution failed', e);
      const message = e instanceof Error ? e.message : String(e);
      result = '';
      tokens = [{ raw: template, error: message }];
    }

    const content = formatPreviewDocument({ kind, template, result, tokens });
    const document = await vscode.workspace.openTextDocument({
      content,
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(document, { preview: false });

    const action = await this.showInformationMessage('Template preview ready.', COPY_RESULT_ACTION);
    if (action === COPY_RESULT_ACTION) {
      await vscode.env.clipboard.writeText(result);
    }
  }

  private async pickTemplate(
    branchTemplateRaw: string,
    tagTemplateRaw: string
  ): Promise<TemplatePick | undefined> {
    const branchTemplate = (branchTemplateRaw ?? '').trim();
    const tagTemplate = (tagTemplateRaw ?? '').trim();

    if (!branchTemplate && !tagTemplate) {
      await this.showErrorMessage(
        'No branch or tag template is configured. Set git-smart-checkout.branchTemplate or git-smart-checkout.tagTemplate in settings.'
      );
      return undefined;
    }

    if (branchTemplate && !tagTemplate) {
      return { kind: 'branch', template: branchTemplate };
    }
    if (tagTemplate && !branchTemplate) {
      return { kind: 'tag', template: tagTemplate };
    }

    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Branch template', description: branchTemplate, templateKind: 'branch' as const },
        { label: 'Tag template', description: tagTemplate, templateKind: 'tag' as const },
      ],
      { title: 'Preview which template?', ignoreFocusOut: true }
    );
    if (!choice) {
      return undefined;
    }
    return {
      kind: choice.templateKind,
      template: choice.templateKind === 'branch' ? branchTemplate : tagTemplate,
    };
  }

  /**
   * Resolves how {s:...} script tokens should be executed for this preview.
   * On the first preview containing a script token for this workspace,
   * prompts for consent (persisted so future previews in the same repo don't
   * ask again). Declining, or dismissing the prompt outright (Escape), is
   * treated the same way: scripts are not run.
   *
   * `runScript` is `undefined` when the real default script runner should be
   * used (no script tokens present, consent already on file, or the user
   * just granted it) — an explicit override is only returned when scripts
   * must NOT run, so every {s:...} token fails with a distinguishable
   * "not authorized" error that resolveWithTrace/formatPreviewDocument
   * render as "skipped (not authorized)" instead of a generic error.
   */
  private async resolveScriptRunner(
    template: string,
    workspaceRoot: string
  ): Promise<{ runScript?: TagTemplateContext['runScript'] }> {
    const scriptPaths = extractScriptTokenPaths(template);
    if (scriptPaths.length === 0) {
      return {};
    }

    if (this.consentStore.hasConsent(workspaceRoot)) {
      return {}; // real default runner — already authorized
    }

    const answer = await this.showInformationMessage(
      `Preview will execute script(s): ${scriptPaths.join(', ')}. Run?`,
      RUN_SCRIPTS_ACTION,
      SKIP_SCRIPTS_ACTION
    );

    if (answer === RUN_SCRIPTS_ACTION) {
      await this.consentStore.grantConsent(workspaceRoot);
      return {}; // real default runner
    }

    // Skip, or dismissed without an explicit choice — don't run anything.
    return {
      runScript: async () => {
        throw new Error(NOT_AUTHORIZED_MARKER);
      },
    };
  }

  private async safeGetCurrentBranch(
    git: Awaited<ReturnType<typeof this.getGitExecutor>>
  ): Promise<string> {
    try {
      const branch = await git.getCurrentBranch();
      return branch ?? '';
    } catch {
      return '';
    }
  }
}
