import 'puppeteer';

const URL = 'http://localhost:5173';

jest.setTimeout(5000);

describe('Minimal E2E', () => {
  beforeAll(async () => {
    await page.goto(URL);
  });

  it('should load the app', async () => {
    const app = await page.waitForSelector('nano-repatch');
    expect(app).toBeTruthy();
  });

  it('should have the correct title', async () => {
    const title = await page.title();
    expect(title).toBe('Nano Repatch');
  });
});
