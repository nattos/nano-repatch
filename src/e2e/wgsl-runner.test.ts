import 'puppeteer';
// Import test cases to iterate over them
import { testCases } from '../customnodes/expr/v2/backend-test-cases';

const PORT = 5173;
const URL = `http://localhost:${PORT}/wgsl.html`;

jest.setTimeout(60000);

describe('WGSL Automated Browser Tests', () => {
  beforeAll(async () => {
    try {
      await page.goto(URL, { waitUntil: 'networkidle0' });
      await page.waitForSelector('wgsl-tester');
    } catch (e) {
      console.error("Failed to load WGSL page. Is the dev server running?");
      throw e;
    }
  });

  // We iterate over the defined test cases
  for (const tc of testCases) {
    if (tc.skipWGSL) {
      it.skip(`${tc.name} (Skipped)`, () => { });
      continue;
    }

    it(`runs ${tc.name}`, async () => {
      const resultStr = await page.evaluate(async (testName) => {
        const app = document.querySelector('wgsl-tester');
        if (!app) return 'Error: App not found';
        // Access component instance
        return await (app as any).runTestByName(testName);
      }, tc.name);

      // Log output for visibility
      console.log(`[${tc.name}]: ${resultStr}`);

      if (resultStr.startsWith('Error:')) {
        throw new Error(resultStr);
      }

      // Optional: Parse result and compare with expected?
      // The python/node test harness does deep comparison.
      // Here we rely on the in-browser run() returning Success.
      // But we can verify strict equality if expected is simple.
      if (tc.expected !== undefined && resultStr.startsWith('Success:')) {
        const jsonPart = resultStr.substring('Success: '.length);
        const val = JSON.parse(jsonPart);

        // Simple equality check for primitives
        if (typeof tc.expected === 'number' || typeof tc.expected === 'boolean') {
          if (Array.isArray(val) && val.length === 1) {
            // Unpacked scalar often comes as array?
            // wgsl-utils unpackData returns number if primitive source type.
            // But if outputType was inferred as number, unpack returns number.
            expect(val).toBeCloseTo(tc.expected as number, 4);
          } else if (typeof val === 'number') {
            expect(val).toBeCloseTo(tc.expected as number, 4);
          } else {
            // Fallback
            expect(val).toEqual(tc.expected);
          }
        }
        // Array check
        else if (Array.isArray(tc.expected)) {
          expect(val).toEqual(tc.expected);
        }
      }
    });
  }
});
