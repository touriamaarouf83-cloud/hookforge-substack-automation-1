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

  const prompt = `
Write a high-quality, original marketing article in Arabic for YouTubers,
NewTubers, and small content creators.

Topic:
Why a strong video can fail because of a weak title or weak opening hook.

Use legitimate persuasion concepts such as:
- Logic Gaps
- Open Loops
- Negative Stakes
- Curiosity
- Viewer retention

Do NOT fabricate statistics.
Do NOT claim guaranteed views, guaranteed CTR, or guaranteed success.
Do NOT use manipulative fear tactics excessively.

The article should provide genuine value first and naturally introduce HookForge AI
as a useful solution for creators.

Explain that HookForge AI helps creators generate:
- YouTube hooks
- Clickable titles
- Video scripts
- Content ideas

Use this exact website:
${HOOKFORGE_URL}

Include the website naturally at least twice.

Return ONLY valid JSON with exactly these two keys:

{
  "title": "Article title",
  "content": "Full article in Markdown"
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

    if (
      !aiGeneratedData.title ||
      !aiGeneratedData.content
    ) {
      throw new Error('Gemini returned incomplete JSON.');
    }

    rawTitle = aiGeneratedData.title;
    articleBody = aiGeneratedData.content;

    console.log(`✨ Generated article: "${rawTitle}"`);

  } catch (error) {
    console.error('❌ Gemini generation failed:', error);
    process.exit(1);
  }

  console.log('🤖 Starting Playwright...');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  try {
    const cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);

    await context.addCookies(cookiesJson);

    const page = await context.newPage();

    await page.goto('https://substack.com', {
      waitUntil: 'networkidle'
    });

    console.log('📝 Opening Substack editor...');

    await page.fill(
      'div[placeholder="Type your title..."]',
      rawTitle
    );

    await page.focus('div[aria-label="Post body"]');

    await page.keyboard.type(articleBody);

    console.log('📤 Publishing...');

    await page.click('button:has-text("Continue")');

    await page.waitForTimeout(3000);

    await page.click(
      'button:has-text("Send to everyone now")'
    );

    console.log(
      '🎉 Article generated with Gemini 3.6 Flash and published successfully!'
    );

    console.log(`🔗 HookForge URL: ${HOOKFORGE_URL}`);

  } catch (error) {
    console.error(
      '❌ Substack automation failed:',
      error
    );

    process.exitCode = 1;

  } finally {
    await browser.close();
  }

})();
