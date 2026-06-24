import { describe, it, expect } from "vitest";

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
}

interface TestReport {
  timestamp: string;
  projectName: string;
  version: string;
  suites: TestSuite[];
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    totalDuration: number;
    successRate: number;
  };
  performance: {
    averageTestDuration: number;
    slowestTest: TestResult | null;
    fastestTest: TestResult | null;
  };
}

export class TestReportGenerator {
  static generateReport(
    suites: TestSuite[],
    projectName: string,
    version: string,
  ): TestReport {
    const totalTests = suites.reduce((sum, suite) => sum + suite.totalTests, 0);
    const passedTests = suites.reduce((sum, suite) => sum + suite.passedTests, 0);
    const failedTests = suites.reduce((sum, suite) => sum + suite.failedTests, 0);
    const skippedTests = suites.reduce((sum, suite) => sum + suite.skippedTests, 0);
    const totalDuration = suites.reduce((sum, suite) => sum + suite.totalDuration, 0);

    const allTests = suites.flatMap((suite) => suite.tests);
    const passedOnly = allTests.filter((t) => t.status === "passed");
    const averageTestDuration =
      passedOnly.length > 0
        ? passedOnly.reduce((sum, t) => sum + t.duration, 0) / passedOnly.length
        : 0;

    const slowestTest =
      passedOnly.length > 0
        ? passedOnly.reduce((slowest, t) => (t.duration > slowest.duration ? t : slowest))
        : null;

    const fastestTest =
      passedOnly.length > 0
        ? passedOnly.reduce((fastest, t) => (t.duration < fastest.duration ? t : fastest))
        : null;

    return {
      timestamp: new Date().toISOString(),
      projectName,
      version,
      suites,
      summary: {
        totalTests,
        passedTests,
        failedTests,
        skippedTests,
        totalDuration,
        successRate: totalTests > 0 ? passedTests / totalTests : 0,
      },
      performance: {
        averageTestDuration,
        slowestTest,
        fastestTest,
      },
    };
  }

  static toHTML(report: TestReport): string {
    const successRate = (report.summary.successRate * 100).toFixed(2);
    const statusClass = report.summary.failedTests === 0 ? "success" : "failure";

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - ${report.projectName} ${report.version}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: #fff; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .metric { background: #fff; padding: 16px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .metric-value { font-size: 24px; font-weight: bold; }
    .metric-label { color: #666; font-size: 14px; }
    .success { color: #28a745; }
    .failure { color: #dc3545; }
    .suite { background: #fff; padding: 16px; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .suite-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .suite-name { font-size: 18px; font-weight: bold; }
    .suite-stats { color: #666; }
    .test { padding: 8px 0; border-bottom: 1px solid #eee; }
    .test:last-child { border-bottom: none; }
    .test-name { font-weight: 500; }
    .test-duration { color: #666; font-size: 14px; }
    .test-status { float: right; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .test-passed { background: #d4edda; color: #155724; }
    .test-failed { background: #f8d7da; color: #721c24; }
    .test-skipped { background: #fff3cd; color: #856404; }
    .performance { background: #fff; padding: 16px; border-radius: 8px; margin-top: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .performance h3 { margin-top: 0; }
    .timestamp { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Test Report</h1>
      <p><strong>${report.projectName}</strong> - Version ${report.version}</p>
      <p class="timestamp">Generated: ${new Date(report.timestamp).toLocaleString()}</p>
    </div>

    <div class="summary">
      <div class="metric">
        <div class="metric-value ${statusClass}">${report.summary.totalTests}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric">
        <div class="metric-value success">${report.summary.passedTests}</div>
        <div class="metric-label">Passed</div>
      </div>
      <div class="metric">
        <div class="metric-value ${report.summary.failedTests > 0 ? 'failure' : ''}">${report.summary.failedTests}</div>
        <div class="metric-label">Failed</div>
      </div>
      <div class="metric">
        <div class="metric-value">${successRate}%</div>
        <div class="metric-label">Success Rate</div>
      </div>
      <div class="metric">
        <div class="metric-value">${(report.summary.totalDuration / 1000).toFixed(2)}s</div>
        <div class="metric-label">Total Duration</div>
      </div>
    </div>

    ${report.suites
      .map(
        (suite) => `
    <div class="suite">
      <div class="suite-header">
        <span class="suite-name">${suite.name}</span>
        <span class="suite-stats">${suite.passedTests}/${suite.totalTests} passed</span>
      </div>
      ${suite.tests
        .map(
          (test) => `
      <div class="test">
        <span class="test-status test-${test.status}">${test.status}</span>
        <span class="test-name">${test.name}</span>
        <span class="test-duration">${test.duration.toFixed(2)}ms</span>
      </div>`,
        )
        .join("")}
    </div>`,
      )
      .join("")}

    <div class="performance">
      <h3>Performance Metrics</h3>
      <p><strong>Average Test Duration:</strong> ${report.performance.averageTestDuration.toFixed(2)}ms</p>
      ${
        report.performance.slowestTest
          ? `<p><strong>Slowest Test:</strong> ${report.performance.slowestTest.name} (${report.performance.slowestTest.duration.toFixed(2)}ms)</p>`
          : ""
      }
      ${
        report.performance.fastestTest
          ? `<p><strong>Fastest Test:</strong> ${report.performance.fastestTest.name} (${report.performance.fastestTest.duration.toFixed(2)}ms)</p>`
          : ""
      }
    </div>
  </div>
</body>
</html>`;
  }

  static toJSON(report: TestReport): string {
    return JSON.stringify(report, null, 2);
  }
}

describe("Test Report Generator", () => {
  it("should generate a test report", () => {
    const suites: TestSuite[] = [
      {
        name: "Example Suite",
        tests: [
          { name: "Test 1", status: "passed", duration: 10 },
          { name: "Test 2", status: "passed", duration: 20 },
          { name: "Test 3", status: "failed", duration: 15, error: "Assertion failed" },
        ],
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        skippedTests: 0,
        totalDuration: 45,
      },
    ];

    const report = TestReportGenerator.generateReport(suites, "Test Project", "1.0.0");

    expect(report.projectName).toBe("Test Project");
    expect(report.version).toBe("1.0.0");
    expect(report.summary.totalTests).toBe(3);
    expect(report.summary.passedTests).toBe(2);
    expect(report.summary.failedTests).toBe(1);
    expect(report.summary.successRate).toBeCloseTo(0.667, 2);
  });

  it("should generate HTML report", () => {
    const suites: TestSuite[] = [
      {
        name: "HTML Suite",
        tests: [{ name: "HTML Test", status: "passed", duration: 5 }],
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        totalDuration: 5,
      },
    ];

    const report = TestReportGenerator.generateReport(suites, "HTML Project", "2.0.0");
    const html = TestReportGenerator.toHTML(report);

    expect(html).toContain("HTML Project");
    expect(html).toContain("2.0.0");
    expect(html).toContain("HTML Test");
    expect(html).toContain("100.00%");
  });

  it("should generate JSON report", () => {
    const suites: TestSuite[] = [
      {
        name: "JSON Suite",
        tests: [{ name: "JSON Test", status: "passed", duration: 3 }],
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        totalDuration: 3,
      },
    ];

    const report = TestReportGenerator.generateReport(suites, "JSON Project", "3.0.0");
    const json = TestReportGenerator.toJSON(report);
    const parsed = JSON.parse(json);

    expect(parsed.projectName).toBe("JSON Project");
    expect(parsed.version).toBe("3.0.0");
    expect(parsed.summary.totalTests).toBe(1);
  });
});
