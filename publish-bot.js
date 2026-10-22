'use strict';

const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';
const SUBSTACK_HOME = 'https://substack.com/';
const SUBSTACK_EDITOR = 'https://substack.com/publish/post';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getErrorStatus(error) {
  const status = Number(error?.status || error?.code);
  if (Number.isFinite(status) && status > 0) return status;

  const message = String(error?.message || '');
  const match = message.match(/\b(429|500|502|503|504)\b/);
  return match ? Number(match[1]) : 0;
}

async function generateWithRetry(ai, prompt) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`Gemini request ${attempt}/${MAX_ATTEMPTS} (${GEMINI_MODEL})`);

      return await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.8,
          maxOutputTokens: 8192
        }
      });
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      const retryable = [408, 429, 500, 502, 503, 504].includes(status);

      console.error(`Gemini error (status ${status || 'unknown'}):`,
        error?.message || error);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        break;
      }

      const delay = Math.min(30000, 2000 * (2 ** (attempt - 1)));
      console.log(`Retrying in ${Math.ceil(delay / 1000)} seconds...`);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Gemini generation failed without an error message.');
}

function parseArticleResponse(response) {
  let raw = response?.text;

  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Gemini returned an empty response.');
  }

  raw = raw.trim();

  // Remove optional Markdown fences without a regex containing backticks.
  const lines = raw.split(/\r?\n/);
  if (lines.length && /^```(?:json)?\s*$/i.test(lines[0].trim())) {
    lines.shift();
    if (lines.length && lines[lines.length - 1].trim() === '```') {
      lines.pop();
    }
    raw = lines.join('\n').trim();
  }

  let article;
  try {
    article = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Gemini returned invalid JSON: ${error.message}\n` +
      `Response preview:\n${raw.slice(0, 1500)}`
    );
  }

  if (
    !article ||
    typeof article.title !== 'string' ||
    typeof article.content !== 'string' ||
    !article.title.trim() ||
    !article.content.trim()
  ) {
    throw new Error('Gemini response must contain non-empty title and content strings.');
  }

  article.title = article.title.trim();
  article.content = article.content.trim();

  if (!article.content.includes(HOOKFORGE_URL)) {
    article.content += `\n\nTry HookForge AI: ${HOOKFORGE_URL}`;
  }

  return article;
}

async function generateArticle() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY GitHub Actions secret.');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `
You are an experienced content-marketing writer for small YouTube creators.

Write one useful, original English-language article that introduces HookForge AI
naturally while helping creators improve their YouTube titles and opening hooks.

PRODUCT URL:
${HOOKFORGE_URL}

AUDIENCE:
- Small YouTubers and NewTubers
- Micro-creators
- Developers and technical creators

TOPIC:
Why good videos can underperform when their titles and opening hooks are weak.

Discuss naturally:
- Curiosity and open loops
- Logic gaps
- Negative stakes, used honestly and without fearmongering
- Viewer retention
- Strong opening hooks
- Clear, clickable titles

REQUIREMENTS:
- English only.
- Write 900–1,200 words.
- Use a compelling, accurate title.
- Use clear headings, short paragraphs, and useful bullet points.
- Give practical advice that readers can apply.
- Include the exact product URL at least twice.
- Do not invent statistics, testimonials, case studies, or research.
- Do not promise guaranteed views, subscribers, or revenue.
- Do not keyword-stuff or repeat the product name unnaturally.
- Return ONLY valid JSON in this exact shape:
{
  "title": "Article title",
  "content": "Full article content with headings and paragraphs"
}
`;

  const response = await generateWithRetry(ai, prompt);
  const article = parseArticleResponse(response);

  console.log(`Article generated: ${article.title}`);
  console.log(`Article length: ${article.content.length} characters`);

  return article;
}

function normalizeCookies(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SUBSTACK_COOKIES is not valid JSON.');
  }

  // Accept either a cookie array or Playwright storageState JSON.
  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(
      'SUBSTACK_COOKIES must contain a non-empty cookie array. ' +
      'Use Playwright-compatible cookies for your own Substack account.'
    );
  }

  return cookies.map((cookie) => {
    const normalized = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly)
    };

    if (!normalized.name || normalized.value === undefined || !normalized.domain) {
      throw new Error('A Substack cookie is missing name, value, or domain.');
    }

    if (cookie.expires !== undefined && Number(cookie.expires) > 0) {
      normalized.expires = Number(cookie.expires);
    } else if (
      cookie.expirationDate !== undefined &&
      Number(cookie.expirationDate) > 0
    ) {
      normalized.expires = Number(cookie.expirationDate);
    }

    const sameSite = String(cookie.sameSite || '').toLowerCase();
    if (sameSite === 'strict') normalized.sameSite = 'Strict';
    else if (sameSite === 'lax') normalized.sameSite = 'Lax';
    else if (sameSite === 'none' || sameSite === 'no_restriction') {
      normalized.sameSite = 'None';
    }

    return normalized;
  });
}

async function findVisible(locator) {
  const count = await locator.count();

  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);

    try {
      if (await item.isVisible()) return item;
    } catch {
      // The element may have disappeared while Substack was rendering.
    }
  }

  return null;
}

async function openEditor(page) {
  console.log('Opening Substack...');
  await page.goto(SUBSTACK_HOME, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await sleep(2000);
  await page.goto(SUBSTACK_EDITOR, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await sleep(4000);

  const url = page.url().toLowerCase();

  if (
    url.includes('/signin') ||
    url.includes('/login') ||
    url.includes('/signup')
  ) {
    throw new Error(
      'Substack redirected to login. SUBSTACK_COOKIES may be expired or invalid.'
    );
  }

  if (!url.includes('substack.com')) {
    throw new Error(`Unexpected editor URL: ${page.url()}`);
  }

  return page;
}

async function fillTitle(page, title) {
  console.log('Finding the title field...');

  const candidates = [
    page.getByRole('textbox', { name: /title/i }),
    page.getByPlaceholder(/title/i),
    page.locator('textarea[placeholder*="title" i]'),
    page.locator('input[placeholder*="title" i]')
  ];

  for (const locator of candidates) {
    const field = await findVisible(locator);
    if (!field) continue;

    try {
      await field.fill(title);
      console.log('Title inserted.');
      return;
    } catch {
      // Try the next matching field.
    }
  }

  throw new Error(
    'Could not identify the title field. Substack may have changed its editor.'
  );
}

async function fillBody(page, content) {
  console.log('Finding the article editor...');

  const candidates = [
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"]')
  ];

  for (const locator of candidates) {
    const editor = await findVisible(locator);
    if (!editor) continue;

    try {
      await editor.click();
      await page.keyboard.insertText(content);
      console.log('Article body inserted.');
      return;
    } catch {
      // Try another matching editor.
    }
  }

  throw new Error(
    'Could not identify the article editor. Substack may have changed its layout.'
  );
}

async function clickContinue(page) {
  console.log('Looking for Continue...');

  const candidates = [
    page.getByRole('button', { name: /^continue$/i }),
    page.locator('button').filter({ hasText: /^Continue$/i })
  ];

  for (const locator of candidates) {
    const button = await findVisible(locator);
    if (!button) continue;

    try {
      await button.click();
      await sleep(2500);
      console.log('Continue clicked.');
      return;
    } catch {
      // Try another candidate.
    }
  }

  throw new Error(
    'Continue was not found. The article may still be in the editor.'
  );
}

async function publishArticle(page) {
  console.log('Looking for the final Publish button...');

  const candidates = [
    page.getByRole('button', { name: /^publish$/i }),
    page.getByRole('button', { name: /publish now/i }),
    page.getByRole('button', { name: /send now/i })
  ];

  for (const locator of candidates) {
    const button = await findVisible(locator);
    if (!button) continue;

    try {
      // This can publish/send the post to your Substack audience.
      await button.click();
      await sleep(4000);

      console.log('Publish button clicked. Verify the post in Substack.');
      return;
    } catch {
      // Try another candidate.
    }
  }

  throw new Error(
    'Final Publish button not found. Check the editor manually; ' +
    'the post may be saved as a draft.'
  );
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY secret.');
  }

  if (!process.env.SUBSTACK_COOKIES) {
    throw new Error('Missing SUBSTACK_COOKIES secret.');
  }

  // Generate and validate the article before opening the publishing editor.
  const article = await generateArticle();

  console.log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  });

  try {
    const cookies = normalizeCookies(process.env.SUBSTACK_COOKIES);
    await context.addCookies(cookies);

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    await openEditor(page);
    await fillTitle(page, article.title);
    await fillBody(page, article.content);

    // Stop before publication if you prefer to review each draft manually.
    if (process.env.PUBLISH_LIVE !== 'true') {
      console.log('Draft filled. PUBLISH_LIVE is not true, so not publishing.');
      console.log('Review the draft, then set PUBLISH_LIVE=true to enable publishing.');
      return;
    }

    await clickContinue(page);
    await publishArticle(page);

    console.log('Publishing action completed; verify the post in Substack.');
    console.log(`Title: ${article.title}`);
    console.log(`HookForge URL: ${HOOKFORGE_URL}`);
  } catch (error) {
    console.error('\nAUTOMATION FAILED');
    console.error(error?.stack || error);

    try {
      const page = context.pages()[0];
      if (page) {
        await page.screenshot({
          path: 'substack-error.png',
          fullPage: true
        });
        console.error(`Failure URL: ${page.url()}`);
        console.error('Diagnostic screenshot saved as substack-error.png');
      }
    } catch (screenshotError) {
      console.error('Could not save screenshot:', screenshotError.message);
    }

    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('FATAL:', error?.message || error);
  process.exitCode = 1;
});
