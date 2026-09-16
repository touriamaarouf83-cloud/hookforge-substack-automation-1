const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';
const SUBSTACK_HOME = 'https://substack.com/';
const SUBSTACK_EDITOR = 'https://substack.com/publish/post';

function normalizeCookies(raw) {
  const cookies = JSON.parse(raw);

  return cookies.map((cookie) => {
    const normalized = { ...cookie };

    if (normalized.sameSite) {
      const value = String(normalized.sameSite).toLowerCase();

      if (value === 'strict') normalized.sameSite = 'Strict';
      else if (value === 'lax') normalized.sameSite = 'Lax';
      else if (value === 'none') normalized.sameSite = 'None';
      else delete normalized.sameSite;
    }

    if (!normalized.sameSite) {
      normalized.sameSite = 'Lax';
    }

    return normalized;
  });
}

async function generateArticle() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing.');
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  const prompt = `
You are an expert YouTube growth and content-marketing writer.

Write ONE original English-language article promoting HookForge AI.

PRODUCT:
HookForge AI helps creators generate:
- high-click-through-rate YouTube titles
- strong opening hooks
- high-retention video scripts
- better curiosity-driven video concepts

PRODUCT URL:
${HOOKFORGE_URL}

TARGET AUDIENCE:
- small YouTubers
- NewTubers
- micro-creators
- developers and technical creators

ARTICLE TOPIC:
Why great YouTube videos can fail because of weak titles and weak opening hooks.

Discuss naturally:
- Logic Gaps
- Open Loops
- Curiosity
- Negative Stakes
- Viewer Retention
- Strong YouTube Hooks
- Clickable Titles

REQUIREMENTS:
- English ONLY.
- Do not use Arabic.
- Do not mix languages.
- Do not invent statistics.
- Do not promise guaranteed views, subscribers, or revenue.
- Give practical and useful advice.
- Introduce HookForge AI naturally.
- Include the exact product URL at least twice.
- Make the article useful even without buying anything.
- No fake testimonials.
- No fake case studies.
- No exaggerated claims.
- 900 to 1400 words.
- Use clear headings.
- Use short paragraphs.
- Use bullet points where useful.
- Finish with a natural call to action.

Return ONLY valid JSON in exactly this format:

{
  "title": "Article title",
  "content": "Full article content"
}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json'
    }
  });

  let raw = response.text.trim();

  // Remove accidental markdown JSON fences
  raw = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let article;

  try {
    article = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Gemini returned invalid JSON.\nResponse:\n${raw.slice(0, 3000)}`
    );
  }

  if (!article.title || !article.content) {
    throw new Error('Gemini response is missing title or content.');
  }

  console.log(`✨ Article generated: "${article.title}"`);

  return article;
}

async function findVisible(locator) {
  const count = await locator.count();

  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);

    try {
      if (await item.isVisible()) {
        return item;
      }
    } catch (_) {
      // Ignore stale/invisible locator
    }
  }

  return null;
}

async function openEditor(page) {
  console.log('🌐 Opening Substack...');

  await page.goto(SUBSTACK_HOME, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(2500);

  console.log(`📍 Current URL: ${page.url()}`);

  console.log('✍️ Opening Substack article editor directly...');

  await page.goto(SUBSTACK_EDITOR, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  console.log(`📍 Editor URL: ${page.url()}`);

  const currentUrl = page.url().toLowerCase();

  if (
    currentUrl.includes('/signin') ||
    currentUrl.includes('/login') ||
    currentUrl.includes('/signup')
  ) {
    throw new Error(
      `Substack redirected to an authentication page: ${page.url()}`
    );
  }

  // Sometimes Substack needs an extra moment to mount the editor.
  await page.waitForTimeout(3000);

  return page;
}

async function fillTitle(page, title) {
  console.log('📝 Detecting title field...');

  const candidates = [
    page.getByRole('textbox', { name: /title/i }),
    page.getByPlaceholder(/title/i),
    page.locator('textarea[placeholder*="title" i]'),
    page.locator('input[placeholder*="title" i]'),
    page.locator('textarea'),
    page.locator('input')
  ];

  for (const locator of candidates) {
    const field = await findVisible(locator);

    if (!field) continue;

    try {
      await field.fill(title);
      console.log('✅ Title inserted.');
      return;
    } catch (_) {
      // Try next candidate
    }
  }

  throw new Error('Could not find the Substack title field.');
}

async function fillBody(page, content) {
  console.log('🧾 Detecting article body editor...');

  const candidates = [
    page.locator('[contenteditable="true"]'),
    page.locator('[role="textbox"][contenteditable="true"]'),
    page.locator('div[contenteditable="true"]')
  ];

  for (const locator of candidates) {
    const editor = await findVisible(locator);

    if (!editor) continue;

    try {
      await editor.click();
      await page.keyboard.insertText(content);

      console.log('✅ Article body inserted.');
      return;
    } catch (_) {
      // Try another editor
    }
  }

  throw new Error('Could not find the Substack article body editor.');
}

async function clickContinue(page) {
  console.log('➡️ Looking for Continue...');

  const candidates = [
    page.getByRole('button', { name: /^continue$/i }),
    page.getByText('Continue', { exact: true }),
    page.locator('button').filter({ hasText: /^Continue$/i })
  ];

  for (const locator of candidates) {
    const button = await findVisible(locator);

    if (!button) continue;

    try {
      await button.click();
      console.log('✅ Continue clicked.');
      await page.waitForTimeout(3000);
      return;
    } catch (_) {
      // Try next candidate
    }
  }

  throw new Error('Could not find the Continue button.');
}

async function publishArticle(page) {
  console.log('🚀 Looking for Publish button...');

  const candidates = [
    page.getByRole('button', { name: /publish/i }),
    page.getByText(/^Publish$/i, { exact: true }),
    page.getByText(/Send to everyone now/i),
    page.getByText(/Publish now/i),
    page.locator('button').filter({ hasText: /publish/i })
  ];

  for (const locator of candidates) {
    const button = await findVisible(locator);

    if (!button) continue;

    try {
      await button.click();

      console.log('✅ Publish action clicked.');

      await page.waitForTimeout(5000);

      return;
    } catch (_) {
      // Try next candidate
    }
  }

  throw new Error(
    'Could not find the final Publish button. The article may be saved as a draft.'
  );
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY secret.');
  }

  if (!process.env.SUBSTACK_COOKIES) {
    throw new Error('Missing SUBSTACK_COOKIES secret.');
  }

  const article = await generateArticle();

  console.log('🤖 Launching browser...');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });

  try {
    const cookies = normalizeCookies(process.env.SUBSTACK_COOKIES);

    console.log(`🍪 Loading ${cookies.length} cookies...`);

    await context.addCookies(cookies);

    const page = await context.newPage();

    page.setDefaultTimeout(30000);

    await openEditor(page);

    console.log('✅ Substack editor opened.');

    await fillTitle(page, article.title);

    await fillBody(page, article.content);

    await page.waitForTimeout(1500);

    await clickContinue(page);

    await publishArticle(page);

    console.log('');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY');
    console.log(`🔗 HookForge: ${HOOKFORGE_URL}`);
    console.log(`📰 Title: ${article.title}`);
    console.log('');
  } catch (error) {
    console.error('');
    console.error('❌ AUTOMATION FAILED');
    console.error('----------------------------------------');
    console.error(error);
    console.error('----------------------------------------');

    try {
      const page = context.pages()[0];

      if (page) {
        await page.screenshot({
          path: 'substack-error.png',
          fullPage: true
        });

        console.log('📸 Error screenshot saved as substack-error.png');

        console.log(`📍 Failure URL: ${page.url()}`);
        console.log(`📄 Page title: ${await page.title()}`);
      }
    } catch (screenshotError) {
      console.error(
        'Could not save diagnostic screenshot:',
        screenshotError.message
      );
    }

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('❌ FATAL ERROR');
  console.error(error);
  process.exitCode = 1;
});
async function generateWithRetry(ai, prompt, maxAttempts = 5) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🤖 Gemini attempt ${attempt}/${maxAttempts}...`);

      return await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

    } catch (error) {
      lastError = error;

      const status = error?.status || error?.code;

      if (![429, 500, 502, 503, 504].includes(Number(status))) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      const delay =
        Math.min(30000, 2000 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 1000);

      console.log(
        `⚠️ Gemini returned ${status}. Retrying in ${Math.round(delay / 1000)}s...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
