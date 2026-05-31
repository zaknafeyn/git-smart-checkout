# Create Branch from Template

Command: `Git Smart Checkout: Create Branch from Template ...`

Create and check out a new Git branch from a configurable template. Supports Jira issue keys and titles, file JSON values, branch regex matches, script output, and auto-incrementing suffixes when a branch name already exists.

> [!TIP]
> Set `git-smart-checkout.branchTemplate` once per project. When the template uses Jira tokens, configure Jira settings and pick an issue assigned to you.

## Jira Configuration

| Setting | Description |
| --- | --- |
| `git-smart-checkout.jira.domain` | Jira Cloud host, e.g. `your-company.atlassian.net` |
| `git-smart-checkout.jira.username` | Atlassian account username (usually your Atlassian account email) |
| `git-smart-checkout.jira.token` | API token from [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

**Unscoped token (recommended):** use **Create API token** (classic). It works with `https://<domain>.atlassian.net` and needs no scope selection.

**Scoped token (optional):** grant at least `read:jira-work`, `read:jira-user`, `read:issue-details:jira`, and `read:project:jira`.

## Command Visibility

The command appears in the palette only when:

- `git-smart-checkout.branchTemplate` is non-empty, and
- If the template contains `{jira-key}` or `{jira-title...}`, Jira settings are configured and a connection test succeeds.

The connection is re-checked on extension activation and when settings change. Open the **Git Smart Checkout** output channel and look for `[Jira]` and `[Create Branch]` log lines to diagnose connection issues after saving credentials (without logging your token).

## Jira Issue Picker

When the template uses Jira tokens, the command loads all issues assigned to you (`assignee = currentUser()`), sorted by issue key in ascending order.

Each list item shows:

- **Key** (label)
- **Status** (description), e.g. To Do, In Progress, In Review
- **Summary** (detail)

You can type a Jira key manually (e.g. `PROJ-123`) and choose **Use "PROJ-123"** if it is not in the list.

## Template Tokens

| Token | Example | Description |
| --- | --- | --- |
| `{jira-key}` | `{jira-key}` | Uppercase Jira issue key from the picker (e.g. `KEY-123`). |
| `{jira-title[:limit[:separator]]}` | `{jira-title:25:-}` | Slug from the issue summary. Optional `limit` truncates length. Optional `separator` uses its first character (default `-`). |
| `{f:<file>:<json-path>}` | `{f:package.json:.version}` | Reads a JSON value from a workspace-local file. |
| `{b:<regex>}` | `{b:\b[A-Z]+-\d+\b}` | First regex match from the current branch name. |
| `{r:<N>}` | `{r:1}` | Auto-increments from `N` until the branch name does not exist locally or on a remote. |
| `{s:<script>}` | `{s:./script.sh}` | Runs a workspace-local script (stdout). Stops on script failure. |

The resolved branch name is **lowercased** except the Jira key, which stays **uppercase**.

## Example

Template:

```text
vradchuk/{jira-key}-{jira-title:25:-}-{r:1}
```

For Jira issue `KEY-123` with summary `[UI] Implement modal dialog with email retry`, if `vradchuk/KEY-123-ui-implement-modal-dia-1` already exists, the command tries `...-2`, `...-3`, and so on.

## Confirmation

After resolving the template, an **editable input box** shows the branch name. Edit it if needed, then press **Enter** to create and check out the branch (`git checkout -b`). Press **Escape** to cancel.

Branch names are validated for Git ref rules and checked for collisions before creation.

## Security

File and script paths in `{f:...}` and `{s:...}` tokens are restricted to the workspace root, same as tag templates. Jira credentials are stored in VS Code settings only.
