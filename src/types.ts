/**
 * Parsed inputs from action.yml
 */
export interface ParsedInputs {
  apiKey: string;
  githubToken: string;
  apiUrl: string;
  qaLabel: string;
  autoDetect: boolean;
  targetDurationMinutes: number;
  reopenOnFailure: boolean;
  failureLabel: string;
  removeFailureLabelOnSuccess: boolean;
  /** Specific issue number for manual testing (null = use PR linked issues flow) */
  issueNumber: number | null;
  /** Manual test URL override (null = use AI-detected URL from issue) */
  testUrl: string | null;
  /** Custom regex pattern for detecting issue numbers in commit messages */
  issuePattern: string | null;
  /** GitHub repository (owner/repo format) for context - provides README.md and CLAUDE.md to the LLM */
  githubRepo: string;
}

/**
 * Linked issue from GitHub GraphQL API
 */
export interface LinkedIssue {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: Array<{ name: string }>;
  /** Extracted URL for testing (set during processing) */
  _extractedUrl?: string;
}

/**
 * Response from the analyze-issue API endpoint
 */
export interface AnalyzeIssueResponse {
  isTestable: boolean;
  reason?: string;
  testUrl: string | null;
  testInstructions: string;
  outputSchema: Record<string, { type: string; description: string }>;
  confidence: number;
}

/**
 * Playwright test data from RunHuman
 */
export interface PlaywrightData {
  testDurationSeconds: number;
  consoleMessages: Array<{ type: string; message: string; timestamp: string }>;
  networkRequests: Array<{ url: string; method: string; status?: number; timestamp: string }>;
  clicks: Array<{ x: number; y: number; timestamp: string; element?: string }>;
  screenshots: string[];
  videoUrl?: string;
}

/**
 * Extracted result from RunHuman test
 */
export interface ExtractedResult {
  success: boolean;
  explanation: string;
  data: Record<string, unknown>;
}

/**
 * Response from RunHuman QA test
 */
export interface QATestResponse {
  status: string;
  result?: ExtractedResult;
  error?: string;
  costUsd?: number;
  testDurationSeconds?: number;
  testerData?: PlaywrightData;
  jobId?: string;
}

/**
 * Result of testing a single issue
 */
export interface IssueTestResult {
  issueNumber: number;
  status: 'tested' | 'skipped' | 'error';
  passed: boolean;
  testResult?: QATestResponse;
  analysis?: AnalyzeIssueResponse;
  error?: string;
  skipReason?: string;
}

/**
 * Aggregated results for all issues
 */
export interface ActionResults {
  testedIssues: number[];
  passedIssues: number[];
  failedIssues: number[];
  skippedIssues: number[];
  totalCostUsd: number;
  results: IssueTestResult[];
}

/**
 * Comment on a pull request (general or code review comment)
 */
export interface PRComment {
  /** Comment body/content */
  body: string;
  /** Username of the comment author */
  author: string;
  /** ISO timestamp when comment was created */
  createdAt: string;
  /** Whether this is a review comment (on code) vs general PR comment */
  isReviewComment: boolean;
}

/**
 * Pull request context for testing
 */
export interface PRContext {
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Username of the PR author */
  author: string;
  /** All comments (general + review) - filtered and sorted chronologically */
  comments: PRComment[];
}
