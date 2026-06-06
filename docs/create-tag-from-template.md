# Create Tag from Template

Command: `Git Smart Checkout: Create Tag from Template`

Generate Git tags from a configurable template with safe token substitution for file values, branch regex matches, script output, and auto-incrementing suffixes.

> [!TIP]
> Set `git-smart-checkout.tagTemplate` once per project and run this command from the command palette to produce a correct, collision-free tag in one step.

## Template Tokens

| Token | Example | Description |
| --- | --- | --- |
| `{f:<file>:<json-path>}` | `{f:package.json:.version}` | Reads a JSON value from a workspace-local file. |
| `{b:<regex>}` | `{b:\b[A-Z]+-\d{3,4}\b}` | Extracts the first regex match from the current branch name. |
| `{r:<N>:<sep>}` | `{r:1:-}` | Optional uniqueness suffix. If the tag built **without** this token is free, the token is dropped. Otherwise it appends `<sep><N>`, incrementing `N` until the name is free. `N` defaults to `1`; `<sep>` defaults to empty. Bare `{r}` and `{r:<N>}` are also valid. |
| `{s:<script>}` or `{s:stdout\|stderr:<script>}` | `{s:./get-build-id.sh}` | Runs a workspace-local script and uses its output. Defaults to `stdout`; specify `stderr` to capture the error stream instead. Tag generation stops if the script fails. |

## Example

With this template:

```text
mobile-v{f:package.json:.version}-{b:\b[A-Z]+-\d{3,4}\b}{r:1:-}
```

On branch `feature/FEAT-123-login` with `package.json` version `12.3.4`:

- If no `mobile-v12.3.4-FEAT-123` tag exists yet, the command generates `mobile-v12.3.4-FEAT-123` (the `{r}` suffix is dropped).
- If `mobile-v12.3.4-FEAT-123`, `mobile-v12.3.4-FEAT-123-1`, and `mobile-v12.3.4-FEAT-123-2` already exist, it generates:

```text
mobile-v12.3.4-FEAT-123-3
```

## Manual Tag Entry

If `git-smart-checkout.tagTemplate` is empty, the command prompts for a tag name. The input is validated and checked for uniqueness before creation.

## Pushing Tags

Set `git-smart-checkout.pushTagWithoutConfirmation` to push created tags automatically. The remote is controlled by `git-smart-checkout.tagRemote`.

## Security

File paths in `{f:...}` tokens are restricted to the workspace root. Absolute paths, `..` traversal, and symlink escapes are rejected. Tag names are validated against shell-unsafe characters and `git check-ref-format` rules before any Git command is run.
