async function generateWithRetry(ai, prompt, maxAttempts = 5) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🤖 Gemini attempt ${attempt}/${maxAttempts}...`);

      return await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

    } catch (error) {
      lastError = error;

      const status = error?.status || error?.code;

      if (![429, 500, 502, 503, 504].includes(Number(status))) {
        throw error;
      }

      if (attempt === maxAttempts) {
        break;
      }

      const delay =
        Math.min(30000, 2000 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 1000);

      console.log(
        `⚠️ Gemini returned ${status}. Retrying in ${Math.round(delay / 1000)}s...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
