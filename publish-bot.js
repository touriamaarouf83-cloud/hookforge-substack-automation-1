const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY || !process.env.SUBSTACK_COOKIES || !process.env.SUBSTACK_EMAIL) {
    console.error('❌ Environment secrets (GEMINI_API_KEY, SUBSTACK_EMAIL, or SUBSTACK_COOKIES) are missing.');
    process.exit(1);
  }

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

  console.log('🤖 Starting Playwright with real browser footprint...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {
    // حقن الكوكيز
    console.log('🍪 Injecting session cookies...');
    let cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);
    await context.addCookies(cookiesJson.map(c => {
      const n = { ...c };
      if (n.sameSite) {
        const s = String(n.sameSite).toLowerCase();
        if (s === 'strict') n.sameSite = 'Strict';
        else if (s === 'lax') n.sameSite = 'Lax';
        else if (s === 'none') n.sameSite = 'None';
        else delete n.sameSite;
      }
      return n;
    }));

    // التوجه مباشرة للوحة التحكم
    console.log('🌐 Checking authentication status via Dashboard...');
    await page.goto('https://substack.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);

    // 🕵️ الفحص الذكي: هل تم تحويلنا لصفحة تسجيل الدخول؟
    const url = page.url();
    if (url.includes('sign-in') || url.includes('login') || await page.locator('input[type="email"]').isVisible()) {
      console.log('⚠️ Cookies expired or rejected! Triggering Email Login Bypass...');
      
      await page.goto('https://substack.com', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 15000 });
      await page.fill('input[type="email"]', process.env.SUBSTACK_EMAIL);
      
      // الضغط على زر إرسال الرابط السحري
      const submitBtn = 'button[type="submit"], button:has-text("Sign in"), button:has-text("First time logging in")';
      await page.click(submitBtn);
      
      console.log('📧 Substack sent a login link to your email.');
      console.log('🚨 ACTION REQUIRED: Please check your email inbox right now, click the Substack link on your phone/PC to authorize this repository session!');
      
      // التوقف هنا للسماح لك بالضغط على الرابط في بريدك
      console.log('⏳ Waiting 60 seconds for you to click the link in your email...');
      await page.waitForTimeout(60000);
    }

    // الانتقال لإنشاء المقال
    console.log('🌐 Accessing writer panel...');
    await page.goto('https://substack.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log('🔎 Detecting editor inputs...');
    await page.waitForSelector('div[placeholder="Type your title..."]', { state: 'visible', timeout: 20000 });

    console.log('📝 Filling Title & Content...');
    await page.fill('div[placeholder="Type your title..."]', rawTitle);
    
    await page.focus('div[aria-label="Post body"]');
    await page.evaluate(({ body }) => {
      const el = document.querySelector('div[aria-label="Post body"], .prose-editor, [contenteditable="true"]');
      if (el) { el.focus(); document.execCommand('insertText', false, body); }
    }, { body: articleBody });

    await page.waitForTimeout(2000);

    console.log('📤 Submitting post...');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(4000);

    console.log('🚀 Finalizing publication...');
    await page.click('button:has-text("Send to everyone now"), button:has-text("Publish")');
    await page.waitForTimeout(5000);

    console.log('\n==========================================\n🎉 SUCCESS\n==========================================');

  } catch (error) {
    console.error('\n❌ SUBSTACK AUTOMATION FAILED. Generating error screenshot...');
    // 📸 التقاط لقطة شاشة وحفظها في المستودع لمعرفة المشكلة فوراً
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
