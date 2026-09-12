const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY || !process.env.SUBSTACK_SID) {
    console.error('❌ Environment secrets (GEMINI_API_KEY or SUBSTACK_SID) are missing.');
    process.exit(1);
  }

  // 1. Génération de l'article via Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `
You are an expert content marketing strategist specializing in YouTube growth, creator psychology, and AI tools.
Write a completely original, high-quality MARKETING ARTICLE IN ENGLISH for YouTubers and small content creators.
TOPIC: Why great YouTube videos can fail because of weak titles and weak opening hooks.
Incorporate: Logic Gaps, Open Loops, Curiosity, Negative Stakes, Viewer Retention.
Introduce HookForge AI naturally as the solution using this exact URL: ${HOOKFORGE_URL} at least twice.
Return ONLY valid JSON with exactly these two keys:
{
  "title": "English article title",
  "content": "Full article content in Markdown"
}
`;

  let rawTitle, articleBody;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    const generated = JSON.parse(response.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim());
    rawTitle = generated.title;
    articleBody = generated.content;
    console.log(`✨ Article generated: "${rawTitle}"`);
  } catch (error) {
    console.error('❌ Gemini generation failed:', error);
    process.exit(1);
  }

  console.log('🤖 Launching Stealth Browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }
  });

  // Injection forcée du cookie de session principal pour contourner la redirection
  await context.addCookies([
    {
      name: 'substack.sid',
      value: process.env.SUBSTACK_SID,
      domain: '.substack.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax'
    }
  ]);

  const page = await context.newPage();

  try {
    console.log('🌐 Accessing Substack Post Editor directly...');
    await page.goto('https://substack.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Vérification anti-redirection
    const currentUrl = page.url();
    if (currentUrl.includes('sign-in') || currentUrl === 'https://substack.com') {
      throw new Error('🛑 Authentication Failed! Substack rejected the SUBSTACK_SID token. Please refresh your browser cookie.');
    }

    console.log('🔎 Detecting text fields...');
    const titleField = page.locator('div[placeholder*="title"], [contenteditable="true"]').first();
    await titleField.waitFor({ state: 'visible', timeout: 20000 });
    
    console.log('📝 Filling Title...');
    await titleField.fill(rawTitle);

    console.log('✍️ Filling Body Content...');
    const bodyField = page.locator('div[aria-label="Post body"], .prose-editor, div[contenteditable="true"]').last();
    await bodyField.focus();

    await page.evaluate(({ body }) => {
      const editors = document.querySelectorAll('div[contenteditable="true"]');
      const mainEditor = editors[editors.length - 1];
      if (mainEditor) {
        mainEditor.focus();
        document.execCommand('insertText', false, body);
      }
    }, { body: articleBody });

    await page.waitForTimeout(2000);

    console.log('📤 Clicking Continue...');
    await page.locator('button:has-text("Continue"), button.button.primary').first().click();
    await page.waitForTimeout(4000);

    console.log('🚀 Publishing Live to Substack Network...');
    await page.locator('button:has-text("Send to everyone now"), button:has-text("Publish")').first().click();
    await page.waitForTimeout(5000);

    console.log('\n==========================================');
    console.log('🎉 SUCCESS: ARTICLE DISTRIBUTED FOR HOOKFORGE AI');
    console.log('==========================================');

  } catch (error) {
    console.error('\n❌ AUTOMATION CRASHED :');
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
