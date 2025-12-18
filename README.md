# RunHuman Issue Tester Action

Automatically test linked GitHub Issues when PRs are merged using AI-powered human QA testing.

## How It Works

1. When a PR is merged to main (via `push` or `pull_request` event)
2. Action finds linked issues from PR references AND commit message keywords
3. AI analyzes each issue to determine if it's human-testable
4. Real human testers verify the fix via the test URL
5. Results posted as comments; issues reopened on failure

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
| `api-key` | Yes | - | RunHuman API key (starts with `qa_live_`) |
| `github-token` | No | `${{ github.token }}` | GitHub token for API access |
| `issue-number` | No | - | Test a specific issue (bypasses PR detection) |
| `test-url` | No | - | Base test URL (AI will append paths from issues) |
| `qa-label` | No | `qa-test` | Label that marks issues for testing |
| `auto-detect` | No | `true` | Let AI evaluate unlabeled issues for testability |
| `issue-pattern` | No | - | Custom regex to find issue numbers in commits |
| `target-duration-minutes` | No | `5` | Target test duration (1-60 minutes) |
| `reopen-on-failure` | No | `true` | Reopen issue if test fails |
| `failure-label` | No | `qa-failed` | Label to add when test fails |
| `remove-failure-label-on-success` | No | `true` | Remove failure label on pass |
| `api-url` | No | `https://runhuman.com` | RunHuman API base URL |

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

### How `auto-detect` Works

**With `auto-detect: true` (default):**
- Issues with `qa-label` → sent to AI for testability check
- Issues without `qa-label` → also sent to AI for testability check
- AI determines if each issue can be tested by a human (UI bugs yes, code refactoring no)

**With `auto-detect: false`:**
- Issues with `qa-label` → sent to AI for testability check
- Issues without `qa-label` → skipped immediately

In both modes, AI still evaluates whether an issue is actually testable (has a URL, describes something a human can verify, etc.).

### Label-Only Mode

To only test explicitly labeled issues:

```yaml
- uses: runhuman/issue-tester-action@v1
  with:
    api-key: ${{ secrets.RUNHUMAN_API_KEY }}
    auto-detect: 'false'
    qa-label: needs-qa
```

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

- [RunHuman Documentation](https://runhuman.com/docs)
- [API Reference](https://runhuman.com/docs/api-reference)
- [QA Test Action](../qa-test-action) - For testing URLs directly
