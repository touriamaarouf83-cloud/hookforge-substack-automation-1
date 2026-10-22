
'use strict';

const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_ATTEMPTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeCookies(raw) {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SUBSTACK_COOKIES must be valid JSON.');
  }

  const cookies = Array.isArray(parsed) ? parsed : parsed?.cookies;

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error(
      'No cookies found. Use a valid Playwright-compatible cookie export.'
    );
  }

  return cookies.map((cookie) => {
    const item = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly)
    };

    if (!item.name || item.value === undefined || !item.domain) {
      throw new Error('A cookie is missing its name, value, or domain.');
    }

    const expiry = Number(cookie.expires ?? cookie.expirationDate);
    if (Number.isFinite(expiry) && expiry > 0) {
      item.expires = expiry;
    }

    const sameSite = String(cookie.sameSite || '').toLowerCase();

    if (sameSite === 'strict') item.sameSite = 'Strict';
    else if (sameSite === 'lax') item.sameSite = 'Lax';
    else if (
      sameSite === 'none' ||
      sameSite === 'no_restriction'
    ) {
      item.sameSite = 'None';
    }

    return item;
  });
}

function getStatus(error) {
  const status = Number(error?.status || error?.code);
  if (Number.isFinite(status)) return status;

  const match = String(error?.message || '').match(
    /\b(408|429|500|502|503|504)\b/
  );

  return match ? Number(match[1]) : 0;
}

async function generateWithRetry(ai, prompt) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `Gemini request ${attempt}/${MAX_ATTEMPTS}: ${GEMINI_MODEL}`
      );

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

      const status = getStatus(error);
      const retryable = [408, 429, 500, 502, 503, 504].includes(status);

      console.error(
        `Gemini request failed (${status || 'unknown'}):`,
        error.message
      );

      if (!retryable || attempt === MAX_ATTEMPTS) break;

      const delay = Math.min(30000, 2000 * (2 ** (attempt - 1)));

      console.log(`Retrying in ${Math.ceil(delay / 1000)} seconds...`);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Gemini generation failed.');
}

function parseArticle(response) {
  let raw = response?.text;

  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Gemini returned an empty response.');
  }

  raw = raw.trim();

  // Remove optional Markdown code fences.
  const lines = raw.split(/\r?\n/);

  if (lines[0] && /^```(?:json)?\s*$/i.test(lines[0].trim())) {
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
    throw new Error(`Gemini returned invalid JSON: ${error.message}`);
  }

  if (
    typeof article.title !== 'string' ||
    typeof article.content !== 'string' ||
    !article.title.trim() ||
    !article.content.trim()
  ) {
    throw new Error('The generated article must contain title and content.');
  }

  article.title = article.title.trim();
  article.content = article.content.trim();

  if (!article.content.includes(HOOKFORGE_URL)) {
    article.content += `\n\nTry HookForge AI: ${HOOKFORGE_URL}`;
  }

  return article;
}

async function generateArticle() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY GitHub Actions secret.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
You are an experienced content-marketing writer for YouTube creators.

Create one original, helpful English-language article about improving
YouTube video titles and opening hooks.

PRODUCT: HookForge AI
URL: ${HOOKFORGE_URL}

AUDIENCE:
- Small YouTubers and NewTubers
- Micro-creators
- Developers and technical creators

TOPIC:
Why good videos may underperform because of weak titles and opening hooks.

Discuss:
- Curiosity and open loops
- Logic gaps
- Negative stakes used honestly
- Viewer retention
- Strong opening hooks
- Clear, compelling titles

RULES:
- Write 900–1200 words.
- Use a compelling, accurate title.
- Use clear headings and short paragraphs.
- Give practical advice.
- Include the exact product URL at least twice.
- Do not invent statistics, testimonials, or research.
- Do not promise guaranteed views, subscribers, or revenue.
- Do not keyword-stuff.
- Make the article useful even without using the product.
- Return ONLY valid JSON in this exact structure:
{
  "title": "Article title",
  "content": "Full article content"
}
`;

  const response = await generateWithRetry(ai, prompt);
  const article = parseArticle(response);

  console.log(`Article generated: ${article.title}`);
  console.log(`Article length: ${article.content.length} characters`);

  return article;
}

async function findVisible(locator) {
  const count = await locator.count();

  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);

    try {
      if (await item.isVisible()) return item;
    } catch {
      // Continue to the next matching element.
    }
  }

  return null;
}

async function openEditor(page) {
  const publication = String(
    process.env.SUBSTACK_PUBLICATION || ''
  ).trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(publication)) {
    throw new Error(
      'Set SUBSTACK_PUBLICATION to your publication subdomain, ' +
      'without https:// or .substack.com.'
    );
  }

  const editorUrl =
    `https://${publication}.substack.com/publish/post?type=newsletter`;

  console.log(`Opening publication editor: ${editorUrl}`);

  await page.goto(editorUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await sleep(7000);

  console.log(`Current page: ${page.url()}`);

  const url = page.url().toLowerCase();

  if (
    url.includes('/sign-in') ||
    url.includes('/signin') ||
    url.includes('/login') ||
    url.includes('/signup')
  ) {
    throw new Error(
      'Substack redirected to login. Check whether SUBSTACK_COOKIES ' +
      'are current and belong to the correct account.'
    );
  }

  if (!url.includes('substack.com')) {
    throw new Error(`Unexpected editor URL: ${page.url()}`);
  }
}

async function fillTitle(page, title) {
  console.log('Looking for the article title field...');

  const selectors = [
    'textarea[aria-label="title"]',
    'textarea[placeholder="Title"]',
    'textarea[placeholder*="title" i]',
    '[data-testid="post-title"]',
    'input[placeholder="Title"]',
    'input[placeholder*="title" i]',
    '[role="textbox"][aria-label="title"]'
  ];

  for (const selector of selectors) {
    const field = await findVisible(page.locator(selector));

    if (!field) continue;

    try {
      if (!(await field.isEditable())) continue;

      await field.fill(title, { timeout: 10000 });

      const tag = await field.evaluate((element) =>
        element.tagName.toLowerCase()
      );

      const value = tag === 'textarea' || tag === 'input'
        ? await field.inputValue()
        : await field.textContent();

      if (String(value || '').trim() === title.trim()) {
        console.log(`Title entered successfully (${selector}).`);
        return;
      }
    } catch (error) {
      console.log(`Title selector failed: ${selector}`);
    }
  }

  await printEditorDiagnostics(page);

  throw new Error(
    'Title field not found. Review the editor diagnostics above.'
  );
}

async function fillBody(page, content) {
  console.log('Looking for the article body editor...');

  const selectors = [
    '.tiptap.ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];

  for (const selector of selectors) {
    const editor = await findVisible(page.locator(selector));

    if (!editor) continue;

    try {
      await editor.click();
      await page.keyboard.insertText(content);

      console.log(`Article body entered (${selector}).`);
      return;
    } catch (error) {
      console.log(`Body selector failed: ${selector}`);
    }
  }

  await printEditorDiagnostics(page);

  throw new Error(
    'Article body editor not found. Review the editor diagnostics above.'
  );
}

async function printEditorDiagnostics(page) {
  try {
    const fields = await page.locator(
      'textarea, input, [contenteditable="true"], button'
    ).evaluateAll((elements) =>
      elements.slice(0, 80).map((element) => ({
        tag: element.tagName,
        text: (element.innerText || '').slice(0, 80),
        ariaLabel: element.getAttribute('aria-label'),
        placeholder: element.getAttribute('placeholder'),
        testId: element.getAttribute('data-testid'),
        contentEditable: element.getAttribute('contenteditable'),
        visible: Boolean(element.getClientRects().length)
      }))
    );

    console.error(
      'EDITOR DIAGNOSTICS:',
      JSON.stringify(fields, null, 2)
    );

    console.error('Page title:', await page.title());
    console.error('Page URL:', page.url());

    await page.screenshot({
      path: 'substack-error.png',
      fullPage: true
    });

    console.error('Screenshot saved as substack-error.png');
  } catch (error) {
    console.error('Could not collect editor diagnostics:', error.message);
  }
}

async function waitForDraftSave(page) {
  // Substack saves drafts automatically; allow time for autosave.
  console.log('Waiting for the draft to autosave...');
  await sleep(5000);

  const saved = await findVisible(
    page.getByRole('button', { name: /^saved$/i })
  );

  if (saved) {
    console.log('Substack shows the draft as saved.');
  } else {
    console.log(
      'No explicit Saved indicator found. Check the draft in Substack.'
    );
  }
}

async function main() {
  if (!process.env.SUBSTACK_COOKIES) {
    throw new Error('Missing SUBSTACK_COOKIES GitHub Actions secret.');
  }

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
    await waitForDraftSave(page);

    console.log('');
    console.log('DRAFT CONTENT ENTERED');
    console.log(`Title: ${article.title}`);

    if (process.env.PUBLISH_LIVE !== 'true') {
      console.log('PUBLISH_LIVE is not true; leaving the article as a draft.');
      return;
    }

    console.log(
      'PUBLISH_LIVE=true, but this script intentionally does not ' +
      'click the final publishing controls. Review the draft in Substack.'
    );
  } catch (error) {
    console.error('AUTOMATION FAILED:', error.stack || error);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('FATAL:', error.message || error);
  process.exitCode = 1;
});
