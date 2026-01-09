# Runhuman Issue Tester Action

Automatically test linked GitHub Issues when PRs are merged using AI-powered human QA testing.

## Issue Selection Modes

The action supports three ways to select which issues to test:

### 1. Auto Mode (Default)
Automatically detects issues from PR merges:
- Issues linked via "Closes #123" in PR description
- Issues referenced in commit messages (fix, close, resolve keywords)
- Best for CI/CD pipelines triggered by PR merges

### 2. Manual Mode
Test specific issue(s) by number:
```yaml
issue-number: '123'           # Single issue
issue-number: '123, 456, 789' # Multiple issues
```

### 3. Filter Mode
Query issues dynamically with filters:
```yaml
issue-filter: 'state:open stale:30d unassigned'
```

See [Issue Filtering](#issue-filtering) for full syntax.

**Priority:** `issue-number` > `issue-filter` > auto-detection

## Quick Start

```yaml
name: Test Linked Issues

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  test-issues:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: runhuman/issue-tester-action@v1
        with:
          api-key: ${{ secrets.RUNHUMAN_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | - | Runhuman API key (starts with `qa_live_`) |
| `github-token` | No | `${{ github.token }}` | GitHub token for API access |
| `issue-number` | No | - | Issue number(s) to test, comma-separated (e.g., `123` or `123, 456`) |
| `issue-filter` | No | - | Filter query for dynamic issue selection (see [Issue Filtering](#issue-filtering)) |
| `max-issues` | No | `10` | Maximum issues to process in filter mode |
| `test-url` | No | - | Base test URL (AI will append paths from issues) |
| `qa-label` | No | `qa-test` | Label that marks issues for testing |
| `auto-detect` | No | `true` | Let AI evaluate unlabeled issues for testability |
| `issue-pattern` | No | - | Custom regex to find issue numbers in commits |
| `target-duration-minutes` | No | `5` | Target test duration (1-60 minutes) |
| `reopen-on-failure` | No | `true` | Reopen issue if test fails |
| `failure-label` | No | `qa-failed` | Label to add when test fails |
| `remove-failure-label-on-success` | No | `true` | Remove failure label on pass |
| `close-on-success` | No | `true` | Close issue when test passes |
| `test-merges` | No | `true` | Test merge commits with no linked issues (requires test-url) |
| `auto-mode-only-missing-media` | No | `false` | Only test issues missing reproduction media (AI analyzes issue + comments) |
| `api-url` | No | `https://runhuman.com` | Runhuman API base URL |

## Outputs

| Output | Description |
|--------|-------------|
| `tested-issues` | JSON array of tested issue numbers |
| `passed-issues` | JSON array of passed issue numbers |
| `failed-issues` | JSON array of failed issue numbers |
| `skipped-issues` | JSON array of skipped issue numbers |
| `total-cost-usd` | Total cost of all tests in USD |
| `results` | Full results object as JSON |

## Issue Detection

The action finds linked issues from two sources:

### 1. PR Closing References

Issues linked via GitHub's "closes" syntax in the PR:
- PR description: "Closes #123"
- PR linked issues sidebar

### 2. Commit Message Keywords

Issues referenced in the merge commit message:

```
fix #123          fixes #123        fixed #123
close #123        closes #123       closed #123
resolve #123      resolves #123     resolved #123
```

### Custom Issue Patterns

Add custom patterns for project-specific references:

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    # Match "PROJ-123" style references
    issue-pattern: 'PROJ-(\d+)'
```

The pattern must have a capture group `(\d+)` for the issue number.

## Issue Filtering

Use `issue-filter` to dynamically query issues from your repository.

### Filter Syntax

Filters are space-separated and combined with AND logic:

```yaml
issue-filter: 'state:open stale:30d unassigned'
```

| Filter | Syntax | Description |
|--------|--------|-------------|
| state | `state:open`, `state:closed`, `state:all` | Issue state (default: open) |
| age | `age:>30d` | Created more than X days ago |
| stale | `stale:30d` | No activity in X days |
| active | `active:7d` | Has activity in last X days |
| unassigned | `unassigned` | No assignee |
| assigned | `assigned:username` | Assigned to specific user |
| label | `label:bug`, `label:bug,enhancement` | Has specific label(s) |
| no-media | `no-media` | Missing both screenshots and videos |
| no-screenshots | `no-screenshots` | Missing screenshots/images |
| no-video | `no-video` | Missing videos |
| all | `all` | Shorthand for `state:open` |

### Filter Examples

**Stale unassigned issues:**
```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    issue-filter: 'state:open stale:30d unassigned'
    max-issues: '5'
    test-url: ${{ vars.STAGING_URL }}
```

**Old issues with specific labels:**
```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    issue-filter: 'state:open age:>60d label:bug,needs-testing'
    test-url: ${{ vars.STAGING_URL }}
```

**Issues assigned to a user:**
```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    issue-filter: 'state:open assigned:octocat'
    test-url: ${{ vars.STAGING_URL }}
```

**Bug reports missing reproduction media:**
```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    issue-filter: 'state:open label:bug no-media'
    test-url: ${{ vars.STAGING_URL }}
```

### Auto-Detect Mode

When using auto mode (no `issue-number` or `issue-filter`), the `auto-detect` and `qa-label` inputs control which linked issues are tested:

**With `auto-detect: true` (default):**
- Issues with `qa-label` → sent to AI for testability check
- Issues without `qa-label` → also sent to AI for testability check

**With `auto-detect: false`:**
- Issues with `qa-label` → sent to AI for testability check
- Issues without `qa-label` → skipped immediately

To only test explicitly labeled issues:

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    auto-detect: 'false'
    qa-label: needs-qa
```

### Only Missing Media Mode

When `auto-mode-only-missing-media` is enabled, the action only tests issues that are missing reproduction media (screenshots, videos, GIFs). This is useful for capturing reproduction data for bug reports that lack visual evidence.

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    auto-mode-only-missing-media: 'true'
    test-url: ${{ vars.STAGING_URL }}
```

**How it works:**
1. Fetches issue body and comments
2. AI analyzes if reproduction media exists (screenshots showing the bug, videos, screen recordings)
3. Issues WITH media are skipped (already have reproduction data)
4. Issues WITHOUT media proceed to testing (tester will capture reproduction data)

**What counts as reproduction media:**
- Screenshots showing the bug or behavior
- Videos demonstrating the issue
- Animated GIFs showing steps to reproduce

**What does NOT count:**
- Company logos or avatars
- Architectural diagrams
- Code syntax highlighting images

## Test URL Handling

### AI URL Detection

The AI extracts URLs from issue bodies looking for:
- Explicit markers: "Test URL:", "Preview:", "Staging:"
- Preview deployments: *.vercel.app, *.netlify.app
- Markdown links: `[Preview](https://...)`

### Preset Base URL

Provide a base URL that AI will use/enhance:

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    test-url: https://staging.myapp.com
```

When `test-url` is provided:
- AI uses it as the base URL
- If issue mentions a path (e.g., "/dashboard"), AI appends it
- Example: `test-url` = `https://staging.myapp.com`, issue mentions `/settings` → tests `https://staging.myapp.com/settings`

## Manual Testing Mode

Test any issue on demand:

```yaml
name: Manual Issue Test

on:
  workflow_dispatch:
    inputs:
      issue-number:
        description: 'Issue number to test'
        required: true
        type: number
      test-url:
        description: 'Test URL (optional)'
        required: false
        type: string

jobs:
  test-issue:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: runhuman/issue-tester-action@v1
        with:
          api-key: ${{ secrets.RUNHUMAN_API_KEY }}
          issue-number: ${{ inputs.issue-number }}
          test-url: ${{ inputs.test-url }}
```

## Merge Testing (No Linked Issues)

When a PR is merged without any linked issues, the action can still run tests if `test-merges` is enabled (default: `true`) and a `test-url` is provided.

### How It Works

1. Action detects no linked issues from the merge
2. Analyzes the merge diff to understand what changed
3. AI determines if changes are human-testable
4. Runs test on the provided `test-url`
5. Posts summary to the workflow

### When to Use

This is useful for:
- Hotfixes pushed directly without an issue
- Small changes that don't warrant an issue
- Emergency fixes that bypass normal workflow

### Configuration

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    test-url: ${{ vars.STAGING_URL }}  # Required for merge testing
    test-merges: 'true'                 # Default, can be disabled
```

To disable merge testing:

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    test-merges: 'false'
```

## What Makes an Issue Testable

**Testable by humans:**
- UI/UX bugs (buttons, layouts, visual glitches)
- User flows (checkout, login, forms)
- Accessibility issues
- Mobile/responsive design issues
- Error states and edge cases

**NOT testable by humans:**
- Code refactoring
- Documentation updates
- Backend-only changes
- Dependency updates
- Type errors or linting

## Test Results

### On Pass
- Comment posted with test results
- Issue stays closed
- `qa-failed` label removed (if present)

### On Fail
- Detailed comment with findings, screenshots, video
- Issue reopened (if `reopen-on-failure: true`)
- `qa-failed` label added

## Workflow Triggers

The action supports multiple trigger patterns:

### After CI/Deploy (Recommended)

```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  test-issues:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: runhuman/issue-tester-action@v1
        with:
          api-key: ${{ secrets.RUNHUMAN_API_KEY }}
          test-url: ${{ vars.STAGING_URL }}
```

### On PR Merge

```yaml
on:
  pull_request:
    types: [closed]
    branches: [main]

jobs:
  test-issues:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: runhuman/issue-tester-action@v1
        with:
          api-key: ${{ secrets.RUNHUMAN_API_KEY }}
```

### On Push to Main

```yaml
on:
  push:
    branches: [main]

jobs:
  test-issues:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: runhuman/issue-tester-action@v1
        with:
          api-key: ${{ secrets.RUNHUMAN_API_KEY }}
```

The action automatically finds the merged PR from the commit SHA when triggered by `push`.

## Writing Testable Issues

```markdown
## Bug Description
The login button doesn't respond on mobile devices.

## Test URL
https://staging.myapp.com/login

## Steps to Reproduce
1. Open the URL on a mobile device
2. Enter valid credentials
3. Tap the login button
4. Notice nothing happens

## Expected Behavior
User should be logged in and redirected to the dashboard.
```

## Issue Template

```markdown
<!-- .github/ISSUE_TEMPLATE/bug_report.md -->
---
name: Bug Report
labels: qa-test
---

## Description
<!-- Describe the bug -->

## Test URL
<!-- URL where this can be tested -->
https://

## Steps to Reproduce
1.
2.
3.

## Expected Behavior
<!-- What should happen -->
```

## Pricing

Tests are billed at **$0.0018/second** (~$0.32-0.54 for a typical 3-5 minute test).

## Technical Details

### Job Polling

The action polls for job completion every 60 seconds until the job reaches a terminal state:
- `completed` - Test finished successfully
- `error` - Test encountered an error
- `abandoned` - Tester abandoned the test
- `incomplete` - Test did not finish

### Content Limits

To optimize API calls, the action truncates long content:

| Content Type | Character Limit |
|--------------|-----------------|
| Issue body | 2,000 |
| PR body | 1,500 |
| PR comments | 500 each |
| Max comments | 10 |

Full content is still available on GitHub; truncation only affects what's sent to the AI for analysis.

## Troubleshooting

### Issue Not Being Tested

1. Check the issue has the `qa-test` label (or `auto-detect` is enabled)
2. Verify the issue describes something a human can test (not code-only)
3. Ensure the PR uses keywords like "Closes #123" or "Fixes #456"
4. Check commit message for issue references

### Test URL Not Found

- Add a `test-url` input to provide a base URL
- Include explicit URL in issue body with "Test URL:" prefix
- AI looks for preview deployment URLs automatically

### Authentication Errors

Ensure `RUNHUMAN_API_KEY` secret:
- Starts with `qa_live_`
- Is set in repository secrets
- Has not expired

## Links

- [Runhuman Documentation](https://runhuman.com/docs)
- [API Reference](https://runhuman.com/docs/api-reference)
- [QA Test Action](../qa-test-action) - For testing URLs directly
