const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  // =========================================================
  // 1. CHECK SECRETS
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
  // 2. INITIALIZE GEMINI
  // =========================================================

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  // =========================================================
  // 3. GENERATE ENGLISH ARTICLE
  // =========================================================

  const prompt = `
You are an expert content marketing strategist specializing in YouTube
growth, creator psychology, and AI tools.

Write a completely original, high-quality MARKETING ARTICLE IN ENGLISH
for YouTubers, NewTubers, micro-creators, and small content creators.

LANGUAGE REQUIREMENTS:
- Write the entire article in natural English.
- Do NOT write Arabic.
- Do NOT mix languages.
- Do NOT translate the article into Arabic.

TOPIC:

Why great YouTube videos can fail because of weak titles and weak opening
hooks.

Explain the real problem creators face when they spend hours or days
creating a video but fail to attract or retain viewers because the title
doesn't create enough curiosity or the opening fails to capture attention.

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
- Do NOT fabricate statistics.
- Do NOT claim guaranteed views.
- Do NOT claim guaranteed CTR.
- Do NOT claim guaranteed subscribers.
- Do NOT promise guaranteed success.
- Avoid exaggerated fear-based manipulation.
- Provide genuine value before promoting the product.

Then naturally introduce HookForge AI.

Explain that HookForge AI helps creators generate:

- YouTube hooks
- YouTube titles
- Video scripts
- Content ideas

Use this EXACT website URL:

${HOOKFORGE_URL}

IMPORTANT:
- NEVER use https://base44.app
- ONLY use ${HOOKFORGE_URL}
- Include the HookForge URL naturally at least twice.

ARTICLE STRUCTURE:

1. Strong curiosity-driven English title
2. Engaging introduction
3. Explanation of the problem
4. Psychology behind hooks and titles
5. Practical examples
6. Actionable advice
7. Natural HookForge AI introduction
8. Conclusion
9. Clear call to action

The article should feel like a professional creator-industry article,
not a spam advertisement.

Return ONLY valid JSON with exactly these two keys:

{
  "title": "English article title",
  "content": "Full article content in Markdown"
}
`;

  let rawTitle;
  let articleBody;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text.trim();

    // Remove accidental Markdown JSON wrapper if Gemini adds one
    const cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const generated = JSON.parse(cleanJson);

    if (!generated.title || !generated.content) {
      throw new Error('Gemini returned incomplete JSON.');
    }

    rawTitle = generated.title;
    articleBody = generated.content;

    console.log(`✨ Article generated: "${rawTitle}"`);

  } catch (error) {
    console.error('❌ Gemini generation failed:');
    console.error(error);
    process.exit(1);
  }

  // =========================================================
  // 4. START PLAYWRIGHT
  // =========================================================

  console.log('🤖 Starting Playwright...');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  try {

    // =======================================================
    // 5. LOAD SUBSTACK COOKIES
    // =======================================================

    let cookiesJson;

    try {
      cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);
    } catch (error) {
      throw new Error(
        'SUBSTACK_COOKIES is not valid JSON.'
      );
    }

    if (!Array.isArray(cookiesJson)) {
      throw new Error(
        'SUBSTACK_COOKIES must be a JSON array.'
      );
    }

    // Normalize cookie sameSite values
    const normalizedCookies = cookiesJson.map(cookie => {

      const normalized = {
        ...cookie
      };

      if (normalized.sameSite) {

        const sameSite = String(
          normalized.sameSite
        ).toLowerCase();

        if (sameSite === 'strict') {
          normalized.sameSite = 'Strict';
        }

        else if (sameSite === 'lax') {
          normalized.sameSite = 'Lax';
        }

        else if (sameSite === 'none') {
          normalized.sameSite = 'None';
        }

        else {
          delete normalized.sameSite;
        }
      }

      return normalized;
    });

    console.log(
      `🍪 Loading ${normalizedCookies.length} Substack cookies...`
    );

    await context.addCookies(normalizedCookies);

    // =======================================================
    // 6. OPEN SUBSTACK
    // =======================================================

    const page = await context.newPage();

    console.log('🌐 Opening Substack...');

    // IMPORTANT:
    // Do NOT use "networkidle".
    // Substack can keep background requests running indefinitely.
    await page.goto('https://substack.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log('✅ Substack HTML loaded.');

    // Give the page time to initialize its JavaScript
    await page.waitForTimeout(5000);

    // =======================================================
    // 7. FIND THE EDITOR
    // =======================================================

    console.log('🔎 Looking for Substack editor...');

    await page.waitForSelector(
      'div[placeholder="Type your title..."]',
      {
        state: 'visible',
        timeout: 30000
      }
    );

    console.log('✅ Substack editor detected.');

    // =======================================================
    // 8. ENTER TITLE
    // =======================================================

    console.log('📝 Entering article title...');

    await page.fill(
      'div[placeholder="Type your title..."]',
      rawTitle
    );

    // =======================================================
    // 9. ENTER ARTICLE
    // =======================================================

    console.log('✍️ Entering article body...');

    await page.focus(
      'div[aria-label="Post body"]'
    );

    await page.keyboard.type(articleBody);

    // =======================================================
    // 10. CONTINUE
    // =======================================================

    console.log('📤 Clicking Continue...');

    await page.click(
      'button:has-text("Continue")',
      {
        timeout: 30000
      }
    );

    await page.waitForTimeout(3000);

    // =======================================================
    // 11. FINAL PUBLISH
    // =======================================================

    console.log('🚀 Publishing article...');

    await page.click(
      'button:has-text("Send to everyone now")',
      {
        timeout: 30000
      }
    );

    await page.waitForTimeout(5000);

    // =======================================================
    // 12. SUCCESS
    // =======================================================

    console.log('');
    console.log('==========================================');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY');
    console.log('==========================================');
    console.log(`📰 Title: ${rawTitle}`);
    console.log(`🔗 HookForge: ${HOOKFORGE_URL}`);
    console.log('==========================================');

  } catch (error) {

    console.error('');
    console.error('❌ SUBSTACK AUTOMATION FAILED');
    console.error('------------------------------------------');
    console.error(error);
    console.error('------------------------------------------');

    process.exitCode = 1;

  } finally {

    await browser.close();

  }

})();
