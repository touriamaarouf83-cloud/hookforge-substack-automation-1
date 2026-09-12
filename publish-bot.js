const { GoogleGenAI } = require('@google/genai');

const HOOKFORGE_URL = 'https://hook-forge-prime.base44.app/';

(async () => {
  console.log('🧠 Connecting to Gemini 3.6 Flash...');

  if (!process.env.GEMINI_API_KEY || !process.env.SUBSTACK_COOKIES) {
    console.error('❌ Environment secrets (GEMINI_API_KEY or SUBSTACK_COOKIES) are missing.');
    process.exit(1);
  }

  // 1. توليد المقال باستخدام جيميناي
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

  // 2. استخراج الكوكيز وتحويلها لصيغة طلب وب المباشر (HTTP Header)
  console.log('🍪 Processing session cookies for API injection...');
  let cookiesHeader = '';
  try {
    const cookiesJson = JSON.parse(process.env.SUBSTACK_COOKIES);
    cookiesHeader = cookiesJson.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.error('❌ Failed to parse SUBSTACK_COOKIES JSON.');
    process.exit(1);
  }

  // 3. النشر الفوري والمباشر داخل قاعدة بيانات مسودات سوبستاك بدون فتح متصفح
  console.log('🚀 Submitting draft directly via Substack REST API...');
  
  const draftPayload = {
    draft_title: rawTitle,
    draft_subtitle: "Unlock your retention potential with psychological hooks.",
    draft_body: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: articleBody }]
        }
      ]
    }),
    publication_id: null
  };

  try {
    const response = await fetch('https://substack.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookiesHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify(draftPayload)
    });

    if (response.ok) {
      const resData = await response.json();
      console.log('\n==========================================');
      console.log('🎉 DRAFT CONTENT INJECTED SUCCESSFULLY VIA API');
      console.log(`📰 Title: ${rawTitle}`);
      console.log(`🆔 Draft ID: ${resData.id || 'Created'}`);
      console.log('==========================================');
    } else {
      const errText = await response.text();
      throw new Error(`Substack API rejected the token. Status: ${response.status} - ${errText}`);
    }
  } catch (apiError) {
    console.error('❌ SUBSTACK API SUBMISSION FAILED');
    console.error(apiError);
    process.exitCode = 1;
  }
})();
