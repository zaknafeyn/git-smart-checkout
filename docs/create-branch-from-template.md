# Create Branch from Template

Command: `Git Smart Checkout: Create Branch from Template ...`

Create and check out a new Git branch from a configurable template. Supports Jira issue keys and titles, file JSON values, branch regex matches, script output, and auto-incrementing suffixes when a branch name already exists.

> [!TIP]
> Configure one or more named templates in `git-smart-checkout.branchTemplates`, each `{ "name": "...", "template": "..." }`. When several are defined the command shows a picker — search by name **or** by the generated value — before the editable step; a single template skips the picker. When a template uses Jira tokens, configure Jira settings and pick an issue assigned to you.
>
> The deprecated single-value `git-smart-checkout.branchTemplate` still works as a fallback when `branchTemplates` is empty, but will be removed in a future release.

## Selecting a template

When more than one template is configured, the command first shows a template picker:

- The **label** is the template's name; the **description** is a lightweight preview of the generated value.
- The preview resolves `{f:...}` file and `{b:...}` regex tokens against currently available data. To keep the list fast and side-effect free, `{s:...}` scripts and the `{r}` uniqueness suffix are **not** run here (they appear as literal tokens) and Jira is **not** prompted.
- After you pick a template, the normal flow runs: Jira prompt if needed, full token resolution, then the editable input box.

## Jira Configuration

The quickest way to get set up is the `Git Smart Checkout: Init Jira` command, which walks through three prompts:

1. **Domain** — prefilled with the current value if already set.
2. **Username** — prefilled with the current value if already set.
3. **API token** — prefilled and masked (shown as dots) if a token is already stored; leave it unchanged to keep it, clear it to remove it, or type a new one.

Domain and username are written to settings (and stay editable there); the API token is stored in [VS Code Secret Storage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). You can also manage these individually:

| Setting / Command | Description |
| --- | --- |
| `git-smart-checkout.jira.domain` | Jira Cloud host, e.g. `your-company.atlassian.net` |
| `git-smart-checkout.jira.username` | Atlassian account username (usually your Atlassian account email) |
| `git-smart-checkout.jira.projectKeys` | Optional list of project keys to limit the issue picker, e.g. `["KEY", "HOME"]`. Empty (default) shows all issues assigned to you. |
| `git-smart-checkout.jira.customJql` | Raw JQL that replaces the picker's filter button entirely, e.g. `project = KEY AND issuetype = Epic`. `ORDER BY created DESC` is appended automatically unless your query already has an `ORDER BY`. Leave empty to use the in-picker filters. |
| `Git Smart Checkout: Set Jira token` | Set or replace just the API token. It is stored in Secret Storage rather than plaintext settings (which can be synced via Settings Sync). Run it with an empty value to remove the stored token. |

> [!NOTE]
> If you previously set the deprecated `git-smart-checkout.jira.token` setting, it is migrated into Secret Storage and cleared from settings automatically the next time the extension activates.

Create the token at [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

**Unscoped token (recommended):** use **Create API token** (classic). It works with `https://<domain>.atlassian.net` and needs no scope selection.

**Scoped token (optional):** grant at least `read:jira-work`, `read:jira-user`, `read:issue-details:jira`, and `read:project:jira`.

## Command Visibility

The command appears in the palette only when:

- `git-smart-checkout.branchTemplate` is non-empty, and
- If the template contains `{jira-key}` or `{jira-title...}`, Jira settings are configured and a connection test succeeds.

The connection is re-checked on extension activation and when settings change. Open the **Git Smart Checkout** output channel and look for `[Jira]` and `[Create Branch]` log lines to diagnose connection issues after saving credentials (without logging your token).

## Jira Issue Picker

When the template uses Jira tokens, the command loads issues sorted by creation date with the most recently created issues at the top. By default it shows issues assigned to you (`assignee = currentUser()`).

When `git-smart-checkout.jira.projectKeys` is set, the picker is limited to issues from those projects. For example, `["KEY", "HOME"]` shows only issues such as `KEY-123` and `HOME-341`. Leave it empty to include all your assigned issues.

Each list item shows:

- **Key** (label)
- **Status** (description), e.g. To Do, In Progress, In Review
- **Summary** (detail)

You can type a Jira key manually (e.g. `PROJ-123`) and choose **Use "PROJ-123"** if it is not in the list.

### Filtering the picker

Use the **filter** button (funnel icon) in the picker's title bar to change what it lists — useful for finding issues that aren't assigned to you, such as an epic owned by someone else:

- **Assignee** — Me (default), Anyone, or Unassigned.
- **Project** — all configured project keys, or narrow to a single one. When `jira.projectKeys` is empty, the available projects are looked up live from Jira.
- **Status** — Any status (default), To Do, In Progress, or Done.

The chosen filter is remembered per workspace and shown in the picker's title. Results are capped at 500 issues; a broad filter shows a "Showing first 500 issues" notice — narrow the filter or type an issue key directly to reach issues beyond that.

For anything the built-in filters don't cover, set `git-smart-checkout.jira.customJql` to a raw JQL query (e.g. `project = KEY AND issuetype = Epic`); it replaces the filter button entirely while set.

## Template Tokens

| Token | Example | Description |
| --- | --- | --- |
| `{jira-key}` | `{jira-key}` | Uppercase Jira issue key from the picker (e.g. `KEY-123`). |
| `{jira-title[:limit[:separator]]}` | `{jira-title:25:-}` | Slug from the issue summary. Optional `limit` truncates length. Optional `separator` uses its first character (default `-`). |
| `{f:<file>:<json-path>}` | `{f:package.json:.version}` | Reads a JSON value from a workspace-local file. |
| `{b:<regex>}` | `{b:\b[A-Z]+-\d+\b}` | First regex match from the current branch name. |
| `{r:<N>:<sep>}` | `{r:1:-}` | Optional uniqueness suffix. If the branch built **without** this token is free, the token is dropped. Otherwise it appends `<sep><N>`, incrementing `N` until the name is free. `N` defaults to `1`; `<sep>` defaults to empty. Bare `{r}` and `{r:<N>}` are also valid. |
| `{s:<script>}` | `{s:./script.sh}` | Runs a workspace-local script (stdout). Stops on script failure. |

The resolved branch name is **lowercased** except the Jira key, which stays **uppercase**.

## Example

Template:

```text
feature/{jira-key}-{jira-title:25:-}{r:1:-}
```

For Jira issue `KEY-123` with summary `[UI] Implement modal dialog with email retry`, the command first tries `feature/KEY-123-ui-implement-modal-dia`. If that branch already exists, it tries `feature/KEY-123-ui-implement-modal-dia-1`, then `...-2`, and so on until the name is free.

## Confirmation

After resolving the template, an **editable input box** shows the branch name. Edit it if needed, then press **Enter** to create and check out the branch (`git checkout -b`). Press **Escape** to cancel.

Branch names are validated for Git ref rules and checked for collisions before creation.

## Security

File and script paths in `{f:...}` and `{s:...}` tokens are restricted to the workspace root, same as tag templates. Jira credentials are stored in VS Code settings only.
