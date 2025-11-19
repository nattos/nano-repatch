import 'puppeteer';

describe('App', () => {
  beforeAll(async () => {
    await page.goto('http://localhost:5174');
  });

  it('should display "graph-editor"', async () => {
    await page.waitForSelector('nano-repatch >>> graph-editor');
    const graphEditor = await page.$('nano-repatch >>> graph-editor');
    expect(graphEditor).not.toBeNull();
  });
});
