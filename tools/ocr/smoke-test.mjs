import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// 使用真实浏览器验证模块推理或生产版导入窗口的完整识别路径。

const imageArgument = process.argv[2];
const applicationUrl = process.argv[3] || 'http://127.0.0.1:1420/';
const mode = process.argv[4] || 'module';

if (!imageArgument) {
  throw new Error('请提供用于 OCR 验收的 PNG 图片路径。');
}

const imagePath = resolve(imageArgument);
const imageBuffer = await readFile(imagePath);
const imageBase64 = imageBuffer.toString('base64');
const dimensions = {
  width: imageBuffer.readUInt32BE(16),
  height: imageBuffer.readUInt32BE(20),
};
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.error(`[browser:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => console.error(`[browser:pageerror] ${error.stack}`));
  page.on('requestfailed', (request) => {
    console.error(`[browser:requestfailed] ${request.url()} ${request.failure()?.errorText}`);
  });
  if (mode === 'ui') {
    await page.addInitScript(
      ({ base64, width, height }) => {
        window.__screenshotResult = {
          source: 'region',
          text: '',
          image_base64: base64,
          width,
          height,
        };
      },
      { base64: imageBase64, ...dimensions },
    );
  }
  const targetUrl =
    mode === 'ui' ? new URL('/?window=import', applicationUrl).toString() : applicationUrl;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  if (mode === 'ui') {
    const recognizeButton = page.getByRole('button', { name: '识别文字' });
    await recognizeButton.waitFor({ state: 'visible' });
    await expectEnabled(recognizeButton);
    await recognizeButton.click();
    await page.waitForFunction(
      () => document.querySelector('.chat-textarea')?.value.trim().length > 0,
      undefined,
      { timeout: 45_000 },
    );
    const text = await page.locator('.chat-textarea').inputValue();
    const status = await page.locator('.ocr-status').innerText();
    console.log(JSON.stringify({ mode, status, text }, null, 2));
    process.exitCode = text.trim().length > 0 && status.includes('完成') ? 0 : 1;
  } else {
    const result = await page.evaluate(async (base64) => {
      const dimensions = await new Promise((resolveDimensions, reject) => {
        const image = new Image();
        image.onload = () => resolveDimensions({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error('验收图片加载失败。'));
        image.src = `data:image/png;base64,${base64}`;
      });
      const { createOcrModule } = await import('/src/ocr/index.ts');
      const logger = {
        info: (...values) => console.log('[ocr:info]', ...values),
        warn: (...values) => console.warn('[ocr:warn]', ...values),
        error: (...values) => console.error('[ocr:error]', ...values),
      };
      const module = createOcrModule({ logger });
      try {
        const capabilities = await module.capabilities();
        if (!capabilities.available) throw new Error(`OCR 不可用：${capabilities.reason}`);
        const first = await module.recognize({
          imageBase64: base64,
          width: dimensions.width,
          height: dimensions.height,
          requestId: 'ocr-smoke-test-cold',
        });
        const warm = await module.recognize({
          imageBase64: base64,
          width: dimensions.width,
          height: dimensions.height,
          requestId: 'ocr-smoke-test-warm',
        });
        const summarize = (recognized) => ({
          text: recognized.text,
          lineCount: recognized.lines.length,
          confidence: recognized.confidence,
          warnings: recognized.warnings,
          metrics: recognized.metrics,
        });
        return { capabilities, cold: summarize(first), warm: summarize(warm) };
      } finally {
        await module.dispose();
      }
    }, imageBase64);

    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser.close();
}

async function expectEnabled(locator) {
  await locator.evaluate(
    (element) =>
      new Promise((resolveEnabled, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('OCR 按钮持续不可用。')), 10_000);
        const check = () => {
          if (!element.disabled) {
            window.clearTimeout(timeout);
            resolveEnabled();
            return;
          }
          window.setTimeout(check, 50);
        };
        check();
      }),
  );
}
