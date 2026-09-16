const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

const SUBSTACK_HOME = 'https://substack.com/';
const SUBSTACK_DASHBOARD = 'https://substack.com/dashboard';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  // =========================================================
  // CHECK ENVIRONMENT
  // =========================================================

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is missing.');
    process.exit(1);
  }

  if (!process.env.SUBSTACK_COOKIES) {
    console.error('❌ SUBSTACK_COOKIES is missing.');
    process.exit(1);
  }

  // =========================================================
  // GEMINI
  // =========================================================

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const prompt = `
You are an expert English content marketing strategist specializing in
YouTube growth, creator psychology, and AI tools.

Write a completely original article in ENGLISH for:

- YouTubers
- NewTubers
- Micro-creators
- Small content creators

MAIN TOPIC:

Why great YouTube videos can fail because of weak titles and weak opening
hooks.

Explain how a creator can spend hours or days producing a video but fail
to attract or retain viewers because the title does not create enough
curiosity or the opening does not capture attention.

Discuss useful concepts such as:

- Logic Gaps
- Open Loops
- Curiosity
- Negative Stakes
- Viewer Retention
- Strong YouTube Hooks
- Clickable Titles

Give practical examples and actionable advice.

IMPORTANT:

- The entire article MUST be written in natural English.
- Do NOT use Arabic.
- Do NOT mix languages.
- Do NOT fabricate statistics.
- Do NOT claim guaranteed views.
- Do NOT claim guaranteed CTR.
- Do NOT claim guaranteed subscribers.
- Do NOT promise guaranteed success.
- Provide genuine value before promoting the product.
- Make the article feel like a professional creator-industry article,
  not spam.

Then naturally introduce:

HookForge AI

Explain that HookForge AI helps creators generate:

- YouTube hooks
- YouTube titles
- Video scripts
- Content ideas

Use ONLY this exact website:

${HOOKFORGE_URL}

IMPORTANT:

- Never use https://base44.app
- Never use any other HookForge URL.
- Include this exact URL at least twice.

Create a strong curiosity-driven title.

Return ONLY valid JSON:

{
  "title": "English article title",
  "content": "Full article content"
}
`;

  let title;
  let content;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    let text = response.text.trim();

    // Remove accidental markdown JSON fences
    text = text
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const generated = JSON.parse(text);

    if (!generated.title || !generated.content) {
      throw new Error('Gemini returned incomplete JSON.');
    }

    title = generated.title;
    content = generated.content;

    console.log(`✨ Article generated: "${title}"`);

  } catch (error) {
    console.error('❌ Gemini generation failed:');
    console.error(error);
    process.exit(1);
  }

  // =========================================================
  // PLAYWRIGHT
  // =========================================================

  console.log('🤖 Launching browser...');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  // =========================================================
  // LOAD SUBSTACK COOKIES
  // =========================================================

  try {
    let cookies;

    try {
      cookies = JSON.parse(process.env.SUBSTACK_COOKIES);
    } catch {
      throw new Error(
        'SUBSTACK_COOKIES is not valid JSON.'
      );
    }

    if (!Array.isArray(cookies)) {
      throw new Error(
        'SUBSTACK_COOKIES must be a JSON array.'
      );
    }

    // Normalize cookie sameSite values
    cookies = cookies.map(cookie => {
      const normalized = { ...cookie };

      if (normalized.sameSite) {
        const value = String(
          normalized.sameSite
        ).toLowerCase();

        if (value === 'strict') {
          normalized.sameSite = 'Strict';
        } else if (value === 'lax') {
          normalized.sameSite = 'Lax';
        } else if (value === 'none') {
          normalized.sameSite = 'None';
        } else {
          delete normalized.sameSite;
        }
      }

      return normalized;
    });

    console.log(`🍪 Loading ${cookies.length} cookies...`);

    await context.addCookies(cookies);

    // =======================================================
    // OPEN SUBSTACK
    // =======================================================

    const page = await context.newPage();

    page.setDefaultTimeout(30000);

    console.log('🌐 Opening Substack...');

    await page.goto(SUBSTACK_HOME, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(4000);

    console.log(`📍 Current URL: ${page.url()}`);

    // =======================================================
    // OPEN PUBLISHER DASHBOARD
    // =======================================================

    console.log('🏠 Opening Publisher Dashboard...');

    await page.goto(SUBSTACK_DASHBOARD, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    console.log(`📍 Dashboard URL: ${page.url()}`);

    // =======================================================
    // CHECK LOGIN
    // =======================================================

    const currentUrl = page.url();

    if (
      currentUrl.includes('/signin') ||
      currentUrl.includes('/login') ||
      currentUrl.includes('/signup')
    ) {
      throw new Error(
        'Substack session is not authenticated. SUBSTACK_COOKIES has expired or is invalid.'
      );
    }

    console.log('✅ Substack session appears authenticated.');

    // =======================================================
    // FIND CREATE BUTTON
    // =======================================================

    console.log('🔎 Looking for Create button...');

    const createButton = page.getByRole('button', {
      name: /^Create$/i
    }).first();

    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
    } else {
      const createText = page.getByText('Create', {
        exact: true
      }).first();

      if (await createText.isVisible().catch(() => false)) {
        await createText.click();
      } else {
        throw new Error(
          'Could not find the Create button on the Publisher Dashboard.'
        );
      }
    }

    await page.waitForTimeout(1500);

    // =======================================================
    // SELECT ARTICLE
    // =======================================================

    console.log('📰 Selecting Article...');

    const articleOption = page.getByText('Article', {
      exact: true
    }).first();

    if (
      await articleOption.isVisible().catch(() => false)
    ) {
      await articleOption.click();
    } else {
      const articleButton = page.getByRole('button', {
        name: /Article/i
      }).first();

      if (
        await articleButton.isVisible().catch(() => false)
      ) {
        await articleButton.click();
      } else {
        throw new Error(
          'Could not find the Article option.'
        );
      }
    }

    // =======================================================
    // WAIT FOR EDITOR
    // =======================================================

    console.log('⏳ Waiting for Substack editor...');

    await page.waitForTimeout(4000);

    // =======================================================
    // FIND TITLE FIELD
    // =======================================================

    console.log('🔎 Detecting title field...');

    const titleCandidates = [
      page.getByPlaceholder(/title/i).first(),
      page.locator('input[placeholder*="title" i]').first(),
      page.locator('textarea[placeholder*="title" i]').first(),
      page.locator('[contenteditable="true"]').first()
    ];

    let titleField = null;

    for (const candidate of titleCandidates) {
      if (
        await candidate.isVisible().catch(() => false)
      ) {
        titleField = candidate;
        break;
      }
    }

    if (!titleField) {
      throw new Error(
        'Could not find the Substack title field.'
      );
    }

    console.log('✅ Title field detected.');

    await titleField.fill(title);

    // =======================================================
    // FIND BODY EDITOR
    // =======================================================

    console.log('🔎 Detecting body editor...');

    const editableElements = page.locator(
      '[contenteditable="true"]'
    );

    const editableCount = await editableElements.count();

    console.log(
      `🧩 Found ${editableCount} editable element(s).`
    );

    let bodyEditor = null;

    for (let i = 0; i < editableCount; i++) {
      const candidate = editableElements.nth(i);

      if (
        await candidate.isVisible().catch(() => false)
      ) {
        bodyEditor = candidate;
      }
    }

    if (!bodyEditor) {
      throw new Error(
        'Could not find the Substack body editor.'
      );
    }

    console.log('✅ Body editor detected.');

    // =======================================================
    // ENTER ARTICLE
    // =======================================================

    console.log('✍️ Writing article...');

    await bodyEditor.click();

    await page.keyboard.insertText(content);

    await page.waitForTimeout(2000);

    console.log('✅ Article content entered.');

    // =======================================================
    // CONTINUE
    // =======================================================

    console.log('📤 Looking for Continue button...');

    const continueButton = page.getByRole('button', {
      name: /^Continue$/i
    }).first();

    await continueButton.waitFor({
      state: 'visible',
      timeout: 30000
    });

    await continueButton.click();

    console.log('✅ Continue clicked.');

    await page.waitForTimeout(4000);

    // =======================================================
    // FINAL PUBLISH
    // =======================================================

    console.log('🚀 Looking for final publish button...');

    const publishCandidates = [
      page.getByRole('button', {
        name: /Send to everyone now/i
      }).first(),

      page.getByRole('button', {
        name: /^Publish$/i
      }).first(),

      page.getByRole('button', {
        name: /Publish now/i
      }).first()
    ];

    let published = false;

    for (const button of publishCandidates) {

      if (
        await button.isVisible().catch(() => false)
      ) {

        console.log(
          `📌 Found final button: ${await button.innerText().catch(() => 'Publish')}`
        );

        await button.click();

        published = true;

        break;
      }
    }

    if (!published) {
      throw new Error(
        'Could not find the final Publish button.'
      );
    }

    await page.waitForTimeout(5000);

    console.log('');
    console.log('========================================');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY');
    console.log('========================================');
    console.log(`📰 Title: ${title}`);
    console.log(`🔗 HookForge: ${HOOKFORGE_URL}`);
    console.log('========================================');

  } catch (error) {

    console.error('');
    console.error('❌ AUTOMATION FAILED');
    console.error('----------------------------------------');
    console.error(error);
    console.error('----------------------------------------');

    // Save screenshot for debugging
    try {
      const screenshotPage = context.pages()[0];

      if (screenshotPage) {
        await screenshotPage.screenshot({
          path: 'substack-error.png',
          fullPage: true
        });

        console.log(
          '📸 Error screenshot saved as substack-error.png'
        );
      }
    } catch (screenshotError) {
      console.error(
        '⚠️ Could not save screenshot:',
        screenshotError.message
      );
    }

    process.exitCode = 1;

  } finally {

    await browser.close();

  }

})();
