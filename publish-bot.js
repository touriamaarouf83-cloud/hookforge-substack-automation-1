const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is missing.');
    process.exit(1);
  }

  if (!process.env.SUBSTACK_COOKIES) {
    console.error('❌ SUBSTACK_COOKIES is missing.');
    process.exit(1);
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  // =========================================================
  // 1. GENERATE ENGLISH MARKETING ARTICLE
  // =========================================================

  const prompt = `
You are an expert content marketing strategist specializing in YouTube
growth, creator psychology, and AI tools.

Write a completely original, highly engaging MARKETING ARTICLE IN ENGLISH
for YouTubers, NewTubers, micro-creators, and small content creators.

IMPORTANT:
- The entire article MUST be written in natural English.
- Do NOT write Arabic.
- Do NOT mix languages.
- Do NOT fabricate statistics.
- Do NOT promise guaranteed views, CTR, subscribers, or success.
- Provide genuine useful information before promoting the product.
- Make the article feel like a professional creator-industry article,
  not an advertisement.

CORE PROBLEM:

A creator can spend hours or days producing a video, but the video can
underperform because the title does not create enough curiosity or the
opening hook fails to keep viewers watching.

Discuss concepts such as:
- Logic Gaps
- Open Loops
- Curiosity
- Negative Stakes
- Viewer Retention
- Strong YouTube Hooks
- Clickable Titles

Explain these concepts in a practical way that creators can actually use.

Then naturally introduce:

HookForge AI

Explain that HookForge AI helps creators generate:
- High-retention YouTube hooks
- Clickable YouTube titles
- Video scripts
- Content ideas

The product website is:

${HOOKFORGE_URL}

IMPORTANT LINK RULE:
Use ONLY this HookForge URL.
Do NOT use https://base44.app.
Include the HookForge URL naturally at least twice in the article.

The article should have:
- A strong curiosity-driven title
- A compelling introduction
- Clear sections with Markdown headings
- Practical examples
- Useful advice
- A natural HookForge AI section near the end
- A concise conclusion and call to action

Return ONLY valid JSON with exactly two keys:

{
  "title": "English article title",
  "content": "Full English article in Markdown"
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

    const aiGeneratedData = JSON.parse(responseText);

    if (!aiGeneratedData.title || !aiGeneratedData.content) {
      throw new Error('Gemini returned incomplete JSON.');
    }

    rawTitle = aiGeneratedData.title;
    articleBody = aiGeneratedData.content;

    console.log(`✨ Article generated: "${rawTitle}"`);

  } catch (error) {
    console.error('❌ Gemini generation failed:', error);
    process.exit(1);
  }

  // =========================================================
  // 2. START PLAYWRIGHT
  // =========================================================

  console.log('🤖 Starting Playwright...');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  try {

    // =======================================================
    // 3. LOAD AND NORMALIZE SUBSTACK COOKIES
    // =======================================================

    let cookiesJson;

    try {
      cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);
    } catch (error) {
      throw new Error('SUBSTACK_COOKIES is not valid JSON.');
    }

    if (!Array.isArray(cookiesJson)) {
      throw new Error('SUBSTACK_COOKIES must contain a JSON array.');
    }

    // Fix incompatible cookie attributes
    const normalizedCookies = cookiesJson.map(cookie => {

      const normalized = {
        ...cookie
      };

      // Playwright only accepts Strict, Lax, or None
      if (normalized.sameSite) {
        const value = String(normalized.sameSite).toLowerCase();

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

    console.log(`🍪 Loading ${normalizedCookies.length} Substack cookies...`);

    await context.addCookies(normalizedCookies);

    // =======================================================
    // 4. OPEN SUBSTACK
    // =======================================================

    const page = await context.newPage();

    console.log('🌐 Opening Substack...');

    await page.goto('https://substack.com', {
      waitUntil: 'networkidle'
    });

    // =======================================================
    // 5. PUBLISH ARTICLE
    // =======================================================

    console.log('📝 Entering article title...');

    await page.fill(
      'div[placeholder="Type your title..."]',
      rawTitle
    );

    console.log('✍️ Entering article body...');

    await page.focus('div[aria-label="Post body"]');

    await page.keyboard.type(articleBody);

    console.log('📤 Continuing to publication settings...');

    await page.click('button:has-text("Continue")');

    await page.waitForTimeout(3000);

    console.log('🚀 Publishing article...');

    await page.click(
      'button:has-text("Send to everyone now")'
    );

    console.log('======================================');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY');
    console.log('======================================');
    console.log(`Title: ${rawTitle}`);
    console.log(`HookForge: ${HOOKFORGE_URL}`);

  } catch (error) {

    console.error('❌ Substack automation failed:');
    console.error(error);

    process.exitCode = 1;

  } finally {

    await browser.close();

  }

})();
