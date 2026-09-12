const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://base44.app';

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
You are an expert content marketing strategist specializing in YouTube growth, creator psychology, and AI tools.
Write a completely original, high-quality MARKETING ARTICLE IN ENGLISH for YouTubers, NewTubers, micro-creators, and small content creators.

LANGUAGE REQUIREMENTS:
- Write the entire article in natural English.
- Do NOT write Arabic.
- Do NOT mix languages.
- Do NOT translate the article into Arabic.

TOPIC: Why great YouTube videos can fail because of weak titles and weak opening hooks.
Explain the real problem creators face when they spend hours or days creating a video but fail to attract or retain viewers because the title doesn't create enough curiosity or the opening fails to capture attention.

Discuss useful concepts such as: Logic Gaps, Open Loops, Curiosity, Negative Stakes, Viewer Retention, Strong YouTube Hooks, Clickable Titles.
Give practical examples and actionable advice.

IMPORTANT:
- Do NOT fabricate statistics, claim guaranteed success, or promise exact CTR/subscribers.
- Provide genuine value before promoting the product.

Then naturally introduce HookForge AI.
Explain that HookForge AI helps creators generate: YouTube hooks, YouTube titles, video scripts, content ideas.

Use this EXACT website URL: ${HOOKFORGE_URL}
Include the HookForge URL naturally at least twice. Do NOT use any alternate domain names.

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

    // Clean eventual markdown blocks appended by the LLM
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
    console.error('❌ Gemini generation failed:', error);
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
      throw new Error('SUBSTACK_COOKIES is not valid JSON.');
    }

    if (!Array.isArray(cookiesJson)) {
      throw new Error('SUBSTACK_COOKIES must be a JSON array.');
    }

    const normalizedCookies = cookiesJson.map(cookie => {
      const normalized = { ...cookie };
      if (normalized.sameSite) {
        const sameSite = String(normalized.sameSite).toLowerCase();
        if (sameSite === 'strict') normalized.sameSite = 'Strict';
        else if (sameSite === 'lax') normalized.sameSite = 'Lax';
        else if (sameSite === 'none') normalized.sameSite = 'None';
        else delete normalized.sameSite;
      }
      return normalized;
    });

    console.log(`🍪 Loading ${normalizedCookies.length} Substack cookies...`);
    await context.addCookies(normalizedCookies);

    // =======================================================
    // 6. OPEN SUBSTACK DIRECTLY TO CREATOR FLOW
    // =======================================================

    const page = await context.newPage();

    console.log('🌐 Directing browser to Substack Publish Studio...');
    
    // Crucial Change: Bypass home URL to hit the dashboard creation panel
    await page.goto('https://substack.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    console.log('✅ Substack Workspace loaded.');
    await page.waitForTimeout(5000);

    // =======================================================
    // 7. FIND THE EDITOR
    // =======================================================

    console.log('🔎 Detecting title inputs...');
    
    // Dynamic fallback selectors capturing Substack UI updates
    const titleSelector = 'div[placeholder="Type your title..."], input[placeholder="Type your title..."], .post-title-editor';
    await page.waitForSelector(titleSelector, {
      state: 'visible',
      timeout: 30000
    });

    console.log('✅ Editor element is active.');

    // =======================================================
    // 8. ENTER TITLE
    // =======================================================

    console.log('📝 Injecting dynamic heading...');
    await page.fill(titleSelector, rawTitle);

    // =======================================================
    // 9. ENTER ARTICLE BODY
    // =======================================================

    console.log('✍️ Accessing composition interface...');
    const bodySelector = 'div[aria-label="Post body"], .prose-editor, div[contenteditable="true"]';
    await page.waitForSelector(bodySelector, { state: 'visible', timeout: 20000 });
    await page.focus(bodySelector);

    // Safe execution command avoiding keyboard lag over long articles
    await page.evaluate(({ selector, body }) => {
      const editor = document.querySelector(selector);
      if (editor) {
        editor.focus();
        document.execCommand('insertText', false, body);
      }
    }, { selector: bodySelector, body: articleBody });

    await page.waitForTimeout(3000);

    // =======================================================
    // 10. CONTINUE
    // =======================================================

    console.log('📤 Submitting post preview...');
    const continueButton = 'button:has-text("Continue"), button.button.primary';
    await page.waitForSelector(continueButton, { state: 'visible', timeout: 20000 });
    await page.click(continueButton);

    await page.waitForTimeout(4000);

    // =======================================================
    // 11. FINAL PUBLISH
    // =======================================================

    console.log('🚀 Finalizing publication pipeline...');
    const publishButton = 'button:has-text("Send to everyone now"), button:has-text("Publish")';
    await page.waitForSelector(publishButton, { state: 'visible', timeout: 20000 });
    await page.click(publishButton);

    await page.waitForTimeout(5000);

    // =======================================================
    // 12. SUCCESS LOGS
    // =======================================================

    console.log('');
    console.log('==========================================');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY TO SUBSTACK');
    console.log('==========================================');
    console.log(`📰 Title: ${rawTitle}`);
    console.log(`🔗 HookForge: ${HOOKFORGE_URL}`);
    console.log('==========================================');

  } catch (error) {
    console.error('');
    console.error('❌ SUBSTACK AUTOMATION ENCOUNTERED AN ERROR');
    console.error('------------------------------------------');
    console.error(error);
    console.error('------------------------------------------');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
