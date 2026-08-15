const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('[geminiService] pdf-parse require fallback', e.message);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Candidate models with fallback
const CANDIDATE_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

// HTTPS agent allowing scrapers to fetch external sites without SSL cert blocks
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Robust web page scraper using cheerio & axios
 */
async function scrapeWebPage(targetUrl) {
  try {
    let cleanUrl = targetUrl.trim().replace(/[),;]+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const response = await axios.get(cleanUrl, {
      timeout: 10000,
      maxRedirects: 5,
      httpsAgent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(response.data);

    // Remove scripts, styles, noscript, svg, nav, footer, ads, popups
    $('script, style, noscript, svg, iframe, nav, footer, header, form, aside, .ad, .ads, .cookie-banner').remove();

    // Extract title
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().trim() ||
      $('h1').first().text().trim() ||
      cleanUrl;

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    const textElements = [];
    $('h1, h2, h3, h4, h5, h6, p, li, article, section, pre, code').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length > 25 && !textElements.includes(t)) {
        textElements.push(t);
      }
    });

    const bodyText = textElements.slice(0, 60).join('\n\n');
    const combinedContent = description
      ? `Description: ${description}\n\n${bodyText}`
      : bodyText;

    return {
      success: true,
      title,
      url: cleanUrl,
      content: combinedContent.slice(0, 20000),
    };
  } catch (err) {
    console.error('[geminiService] Web scraping error for', targetUrl, err.message);
    return {
      success: false,
      title: targetUrl,
      url: targetUrl,
      content: `Could not directly scrape external URL (${targetUrl}): ${err.message}. Please analyze based on URL domain and user context.`,
    };
  }
}

/**
 * Extract text from PDF buffer
 */
async function extractPdfText(buffer) {
  try {
    if (!pdfParse) return '';
    const data = await pdfParse(buffer);
    return data.text ? data.text.trim().slice(0, 35000) : '';
  } catch (err) {
    console.error('[geminiService] PDF parse error:', err.message);
    return '';
  }
}

/**
 * System prompt tailored to Hackord and specific plugins
 */
function getSystemPrompt(pluginTitle) {
  const basePrompt = `You are Hackord AI Workspace Assistant, the premier developer & hackathon collaboration intelligence system for Hackord platform.
Always deliver state-of-the-art, high precision, hallucination-free, structured, and visually stunning technical responses.
Use GitHub Flavored Markdown (GFM) with rich headers, tables, bullet points, clean formatting, and copyable code fences.
You have memory of all prior messages and files shared in this conversation. Relate new answers to previous context and discussions.
When external web links or attached files are provided in the context, thoroughly read, validate, and reference their contents in your response.`;

  if (!pluginTitle) return basePrompt;

  if (pluginTitle === 'Generate PPT') {
    return `${basePrompt}

CRITICAL INSTRUCTION FOR [Generate PPT Plugin Mode]:
The user wants a structured, pitch-ready presentation slide deck.
You MUST DIRECTLY GENERATE THE COMPLETE SLIDES. DO NOT give tips, advice, or steps on how to create a PowerPoint.
You must output ONLY the slide-by-slide presentation deck using this standardized format:

# Slide 1: [Slide Title]
**Subtitle / Tagline**
- Key point 1
- Key point 2
- Key point 3
> **Speaker Notes:** Presenter talking points for this slide.

---

# Slide 2: [Slide Title]
**Subtitle / Tagline**
- Key point 1
- Key point 2
- Key point 3
> **Speaker Notes:** Presenter talking points for this slide.

---

# Slide 3: [Slide Title]
...

Include 5 to 8 complete, well-crafted slides covering:
1. Executive Summary & Core Problem
2. Solution & Value Proposition
3. Target Users & Market Opportunity
4. System Architecture & Tech Stack
5. Key Product Features & Innovation
6. Business Model & Monetization
7. Roadmap & Milestones
8. Conclusion & Call to Action`;
  }

  if (pluginTitle === 'Workflow Diagram' || pluginTitle === 'Architecture Diagram') {
    return `${basePrompt}

You are operating in [${pluginTitle} Plugin Mode].
Provide a comprehensive technical explanation and ALWAYS include a clean, syntactically valid GFM Mermaid diagram block:

\`\`\`mermaid
graph TD
  A["User Client"] --> B["API Gateway"]
  B --> C["Database / Cache"]
\`\`\`

Ensure all node identifiers are alphanumeric without special characters, and label texts inside quotes or brackets (e.g. A["User Web Client"] --> B["Express Backend"]).
Follow with a structured technical breakdown of each component, data flow, security model, and latency considerations.`;
  }

  if (pluginTitle === 'Generate README') {
    return `${basePrompt}

You are operating in [Generate README Plugin Mode].
Directly generate a complete, production-ready GitHub README.md with badges, project overview, architectural flow, tech stack table, installation guide, environment variables setup, API specifications, and license.`;
  }

  if (pluginTitle === 'Idea Validation') {
    return `${basePrompt}

You are operating in [Idea Validation Plugin Mode].
Stress-test and evaluate the project idea across 6 critical hackathon/market dimensions:
1. **Problem Severity & Market Need** (Score 1-10)
2. **Technical Feasibility & Complexity** (Score 1-10)
3. **Novelty & Differentiation** (Score 1-10)
4. **Monetization & Scalability** (Score 1-10)
5. **Key Risks & Blind Spots**
6. **High-Impact Pivot / Growth Suggestions**`;
  }

  if (pluginTitle === 'Tech Stack') {
    return `${basePrompt}

You are operating in [Tech Stack Proposal Plugin Mode].
Recommend a modern, production-grade tech stack customized for the project (Frontend, Backend, Database, Real-time WebRTC/WebSockets, AI Models, Hosting, Auth, CI/CD) formatted in clear comparative tables with trade-offs.`;
  }

  if (pluginTitle === 'Task Breakdown') {
    return `${basePrompt}

You are operating in [Task Breakdown Plugin Mode].
Convert the project goals into prioritized sprint tickets across Milestones (Phase 1: MVP Core, Phase 2: Integrations, Phase 3: Polish & Pitch), with estimated story points, assignees, and acceptance criteria.`;
  }

  if (pluginTitle === 'Business Model') {
    return `${basePrompt}

You are operating in [Business Model Plugin Mode].
Deliver a comprehensive Business Model Canvas breakdown: Value Propositions, Customer Segments, Revenue Streams, Cost Structure, Key Partnerships, and 12-month financial projections.`;
  }

  if (pluginTitle === 'Pitch Generator') {
    return `${basePrompt}

You are operating in [Pitch Generator Plugin Mode].
Generate a 3-minute winning hackathon pitch script with timed section markers ([0:00 - 0:30] Hook, [0:30 - 1:15] Demo Flow, [1:15 - 2:00] Architecture & Innovation, [2:00 - 2:45] Business Viability, [2:45 - 3:00] Closing Ask).`;
  }

  if (pluginTitle === 'Demo Script') {
    return `${basePrompt}

You are operating in [Demo Script Plugin Mode].
Storyboard a step-by-step interactive product demonstration highlighting the 'WOW' moments for judges.`;
  }

  if (pluginTitle === 'Elevator Pitch') {
    return `${basePrompt}

You are operating in [Elevator Pitch Plugin Mode].
Deliver a punchy 60-second elevator pitch, memorable hook, and concise summary statement.`;
  }

  return `${basePrompt}

You are operating with plugin [@${pluginTitle}]. Tailor your response with extreme technical detail and structured output.`;
}

/**
 * Call Gemini API with automatic model fallback
 */
async function callGeminiGenerate({ contents, systemInstruction }) {
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const body = {
        contents,
        generationConfig: {
          temperature: 0.6,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      };

      if (systemInstruction) {
        body.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000,
      });

      if (res.data && res.data.candidates && res.data.candidates.length > 0) {
        const candidate = res.data.candidates[0];
        const textParts = candidate.content?.parts?.map((p) => p.text).filter(Boolean) || [];
        const outputText = textParts.join('\n').trim();
        if (outputText) {
          return { text: outputText, modelUsed: model };
        }
      }
    } catch (err) {
      console.warn(`[geminiService] Model ${model} failed (${err.response?.status || err.message}), trying next fallback...`);
      lastError = err;
      if (err.response?.status !== 404 && err.response?.status !== 429) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  throw new Error(
    lastError?.response?.data?.error?.message ||
      lastError?.message ||
      'All Gemini models failed to respond'
  );
}

/**
 * Main prompt processing pipeline with full memory & context injection
 */
async function processAiChat({
  prompt,
  conversationHistory = [],
  pluginTitle = null,
  fileContext = null,
  webUrls = [],
}) {
  const systemInstruction = getSystemPrompt(pluginTitle);

  // Extract URLs from prompt & explicit webUrls list
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"'{}|\\^`]+|[a-zA-Z0-9-]+\.(?:com|org|net|io|dev|app|ai|co|in|edu|gov)(?:\/[^\s<>"'{}|\\^`]*)?/gi;
  const foundUrls = prompt.match(urlRegex) || [];
  const allUrlsToScrape = Array.from(new Set([...(webUrls || []), ...foundUrls])).filter((u) => {
    return (
      !u.endsWith('.png') &&
      !u.endsWith('.jpg') &&
      !u.endsWith('.jpeg') &&
      !u.endsWith('.gif') &&
      !u.endsWith('.pdf') &&
      u.length > 3
    );
  });

  // Scrape any extracted URLs
  let scrapedContextText = '';
  for (const u of allUrlsToScrape.slice(0, 4)) {
    const scraped = await scrapeWebPage(u);
    if (scraped.content) {
      scrapedContextText += `\n\n=== SCRAPED WEB LINK CONTENT: ${scraped.title} (${scraped.url}) ===\n${scraped.content}\n=== END OF SCRAPED WEB LINK CONTENT ===\n`;
    }
  }

  // Build context injection for current turn
  let fileContextText = '';
  if (fileContext) {
    if (fileContext.extractedText) {
      fileContextText = `\n\n=== ATTACHED FILE CONTEXT: "${fileContext.filename || fileContext.name}" (${fileContext.mimeType || fileContext.type || 'text'}) ===\n${fileContext.extractedText}\n=== END OF ATTACHED FILE CONTEXT ===\n`;
    } else if (fileContext.filename || fileContext.name) {
      fileContextText = `\n\n[Attached File: "${fileContext.filename || fileContext.name}" (${fileContext.mimeType || fileContext.type || 'binary/image'})]\n`;
    }
  }

  let enrichedUserPrompt = prompt;
  if (fileContextText) {
    enrichedUserPrompt = `${fileContextText}\nUser Request: ${prompt}`;
  }
  if (scrapedContextText) {
    enrichedUserPrompt = `${enrichedUserPrompt}\n${scrapedContextText}\n\nNote: Please analyze and integrate the above scraped web content directly to fulfill the user's request.`;
  }

  // Assemble alternating history (user -> model -> user -> model)
  const contents = [];

  // Filter prior history (exclude the message currently being sent)
  for (const msg of conversationHistory) {
    // If msg is the current pending message, skip it so we add the fully enriched turn at the end
    if (msg.text === prompt && msg.sender === 'user') {
      continue;
    }

    const role = msg.sender === 'user' ? 'user' : 'model';
    const textContent = msg.text || '';

    // If previous entry had the same role, merge with it to preserve strict turn alternation
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push({ text: textContent });
    } else {
      contents.push({
        role,
        parts: [{ text: textContent }],
      });
    }
  }

  // Prepare current turn parts
  const currentParts = [];

  // If image attachment is present, pass inline data to Gemini
  if (fileContext && fileContext.base64Data) {
    const rawMime = fileContext.mimeType || fileContext.type || 'image/png';
    if (rawMime.startsWith('image/')) {
      const cleanBase64 = fileContext.base64Data.replace(/^data:[^;]+;base64,/, '');
      currentParts.push({
        inlineData: {
          mimeType: rawMime,
          data: cleanBase64,
        },
      });
    }
  }

  currentParts.push({ text: enrichedUserPrompt });

  // Ensure strict alternating pattern: if last history item was 'user', merge or wrap
  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts.push(...currentParts);
  } else {
    contents.push({
      role: 'user',
      parts: currentParts,
    });
  }

  const result = await callGeminiGenerate({ contents, systemInstruction });
  return result;
}

module.exports = {
  scrapeWebPage,
  extractPdfText,
  processAiChat,
};
