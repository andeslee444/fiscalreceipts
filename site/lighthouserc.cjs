/** @type {import('@lhci/cli').LhciConfig} */
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./out",
      url: [
        "http://localhost/",
        "http://localhost/program/0606301D8Z/",
        "http://localhost/program/0601101E/",
        "http://localhost/company/lockheed-martin/",
        "http://localhost/data/",
      ],
      numberOfRuns: 1,
      settings: {
        // Avoid needing a full Chrome install in CI
        chromeFlags: "--no-sandbox --disable-dev-shm-usage",
        // Throttle: desktop-class
        preset: "desktop",
        // Skip service worker (static export)
        disableStorageReset: false,
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["error", { maxNumericValue: 300 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
