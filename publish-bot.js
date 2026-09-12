const { chromium } = require('playwright');
const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://base44.app';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY || !process.env.SUBSTACK_COOKIES) {
    console.error('❌ Environment secrets (GEMINI_API_KEY or SUBSTACK_COOKIES) are missing.');
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

    const responseText = response.text.trim();
    const cleanJson = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const generated = JSON.parse(cleanJson);

    rawTitle = generated.title;
    articleBody = generated.content;
    console.log(`✨ Article generated: "${rawTitle}"`);
  } catch (error) {
    console.error('❌ Gemini generation failed:', error);
    process.exit(1);
  }

  console.log('🤖 Starting Playwright with anti-detection headers...');
  const browser = await chromium.launch({ headless: true });
  
  // Utilisation d'un User-Agent réaliste pour éviter les blocages de sécurité
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
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

    // 🎯 ÉTAPE 1 : Ouvrir la page d'accueil pour valider la session de cookies
    console.log('🌐 Opening Substack Homepage to initial session...');
    await page.goto('https://substack.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    // 🎯 ÉTAPE 2 : Redirection vers le tableau de bord d'écriture
    console.log('🌐 Navigating to Dashboard Writer Studio...');
    await page.goto('https://substack.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    // Si Substack demande de cliquer sur un bouton "New Post"
    const newPostButton = 'a[href*="publish/post"], button:has-text("New post"), .feed-create-post';
    const isButtonVisible = await page.locator(newPostButton).first().isVisible();
    
    if (isButtonVisible) {
      console.log('🖱️ Clicking "New Post" button...');
      await page.locator(newPostButton).first().click();
      await page.waitForTimeout(5000);
    } else {
      // Si aucune redirection n'a marché, tentative finale d'accès direct
      await page.goto('https://substack.com', { waitUntil: 'load' });
    }

    // 🎯 ÉTAPE 3 : Vérification et détection de l'éditeur de titre
    console.log('🔎 Looking for Substack editor elements...');
    const titleSelector = 'div[placeholder="Type your title..."], input[placeholder="Type your title..."], [contenteditable="true"]';
    
    // Attente du sélecteur avec capture d'écran en cas d'échec pour le débogage
    try {
      await page.waitForSelector('div[placeholder="Type your title..."]', { state: 'visible', timeout: 20000 });
    } catch (e) {
      console.log('⚠️ Standard selector failed, trying fallback generic contenteditable...');
      await page.waitForSelector('[contenteditable="true"]', { state: 'visible', timeout: 15000 });
    }
    
    console.log('📝 Entering article title...');
    const titleElement = await page.locator(titleSelector).first();
    await titleElement.fill(rawTitle);

    // 🎯 ÉTAPE 4 : Remplissage du corps du texte
    console.log('✍️ Entering article body...');
    const bodySelector = 'div[aria-label="Post body"], .prose-editor, div[contenteditable="true"]';
    const bodyElement = await page.locator(bodySelector).last(); // L'éditeur de texte est généralement le dernier élément éditable
    await bodyElement.focus();
    
    await page.evaluate(({ body }) => {
      const editors = document.querySelectorAll('div[contenteditable="true"]');
      const bodyEditor = editors[editors.length - 1]; // Sélectionne le bloc principal
      if (bodyEditor) {
        bodyEditor.focus();
        document.execCommand('insertText', false, body);
      }
    }, { body: articleBody });

    await page.waitForTimeout(3000);

    // 🎯 ÉTAPE 5 : Processus de publication
    console.log('📤 Clicking Continue...');
    const continueButton = 'button:has-text("Continue"), button.button.primary';
    await page.click(continueButton);

    await page.waitForTimeout(4000);

    console.log('🚀 Publishing article...');
    const publishButton = 'button:has-text("Send to everyone now"), button:has-text("Publish")';
    await page.click(publishButton);

    await page.waitForTimeout(5000);

    console.log('\n==========================================');
    console.log('🎉 ARTICLE PUBLISHED SUCCESSFULLY TO SUBSTACK');
    console.log(`📰 Title: ${rawTitle}`);
    console.log(`🔗 HookForge: ${HOOKFORGE_URL}`);
    console.log('==========================================');

  } catch (error) {
    console.error('\n❌ SUBSTACK AUTOMATION FAILED');
    console.error('------------------------------------------');
    console.error(error);
    console.error('------------------------------------------');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
