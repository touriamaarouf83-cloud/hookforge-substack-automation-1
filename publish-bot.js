const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY || !process.env.SUBSTACK_COOKIES) {
    console.error('❌ Environment secrets are missing.');
    process.exit(1);
  }

  // 1. توليد المقال عبر جيميناي
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

  console.log('🤖 Launching Playwright with Stealth Bypass & Anti-Fingerprinting...');
  
  // تشغيل المتصفح مع تمرير حزم تخفي تمنع خوارزميات Cloudflare من اكتشاف خوادم جيت هاب
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled', // إخفاء حقيقة أن المتصفح يدار بروبوت
      '--use-fake-ui-for-media-stream',
      '--window-size=1920,1080'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });

  // إضافة خاصية إضافية لإخفاء متغير أتمتة جافا سكريبت بالمتصفح
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    let cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);
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

    await context.addCookies(normalizedCookies);
    const page = await context.newPage();

    // 🎯 التوجه مباشرة إلى صفحة الكتابة، المتصفح المخفي الآن سيعبر التحدي الأمني
    console.log('🌐 Loading Substack Post Studio with Secure Bypass...');
    await page.goto('https://substack.com', {
      waitUntil: 'load',
      timeout: 90000
    });

    await page.waitForTimeout(7000); // إعطاء سكريبتات سوبستاك مهلة للاستقرار

    // 🎯 تحديث السليكتورز: استخدام ميزة تحديد الحقول عبر الـ Placeholder بشكل مباشر ومرن
    console.log('🔎 Intercepting Substack workspace fields...');
    const titleField = page.locator('div[placeholder*="title"], [contenteditable="true"]').first();
    await titleField.waitFor({ state: 'visible', timeout: 30000 });
    
    console.log('📝 Injecting conversion title...');
    await titleField.fill(rawTitle);
    await page.waitForTimeout(1000);

    console.log('✍️ Injecting psychological hooks...');
    // التركيز على حقل نص المقال الرئيسي
    const bodyField = page.locator('div[aria-label="Post body"], .prose-editor, div[contenteditable="true"]').last();
    await bodyField.focus();

    await page.evaluate(({ body }) => {
      const editors = document.querySelectorAll('div[contenteditable="true"]');
      const mainEditor = editors[editors.length - 1]; // الحقل الأخير دائماً هو متن المقال
      if (mainEditor) {
        mainEditor.focus();
        document.execCommand('insertText', false, body);
      }
    }, { body: articleBody });

    await page.waitForTimeout(3000);

    // الضغط على أزرار النشر النهائي
    console.log('📤 Processing submission layouts...');
    const continueBtn = page.locator('button:has-text("Continue"), button.button.primary').first();
    await continueBtn.click();

    await page.waitForTimeout(4000);

    console.log('🚀 Blasting content to Substack network...');
    const publishBtn = page.locator('button:has-text("Send to everyone now"), button:has-text("Publish")').first();
    await publishBtn.click();

    await page.waitForTimeout(5000);

    console.log('\n==========================================');
    console.log('🎉 BYPASS SUCCESSFUL: ARTICLE PUBLISHED TO SUBSTACK');
    console.log(`📰 Title: ${rawTitle}`);
    console.log(`🔗 Promotion Target: ${HOOKFORGE_URL}`);
    console.log('==========================================');

  } catch (error) {
    console.error('\n❌ PIPELINE BOT CRASHED');
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
