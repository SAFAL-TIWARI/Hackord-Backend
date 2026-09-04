/**
 * Normalize and infer standard MIME types for multimodal Gemini analysis
 */
function normalizeMimeType(rawMime, filename = '') {
  let mime = (rawMime || '').toLowerCase().trim();
  const ext = (filename.toLowerCase().split('.').pop() || '').trim();

  if (!mime || mime === 'application/octet-stream') {
    switch (ext) {
      case 'mp3': return 'audio/mp3';
      case 'wav': return 'audio/wav';
      case 'm4a': return 'audio/m4a';
      case 'aac': return 'audio/aac';
      case 'ogg': return 'audio/ogg';
      case 'flac': return 'audio/flac';
      case 'webm': return (filename.includes('audio') || filename.includes('voice')) ? 'audio/webm' : 'video/webm';
      case 'mp4': return 'video/mp4';
      case 'mov': return 'video/quicktime';
      case 'mkv': return 'video/x-matroska';
      case 'avi': return 'video/x-msvideo';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'pdf': return 'application/pdf';
      default: return mime || 'application/octet-stream';
    }
  }

  // Common aliases mapping
  if (mime === 'audio/mpeg') return 'audio/mp3';
  if (mime === 'audio/x-m4a' || mime === 'audio/mp4') return 'audio/m4a';
  if (mime === 'audio/x-wav') return 'audio/wav';
  if (mime === 'video/mov') return 'video/quicktime';

  return mime;
}

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
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-latest',
  "gemini-3.8-flash",
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
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
      timeout: 3500,
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
/**
 * System prompt tailored to Hackord and specific plugins
 */
function getSystemPrompt(pluginTitle) {
  const basePrompt = `You are Hackord AI Workspace Assistant, the premier developer and hackathon collaboration intelligence system for Hackord platform.
Always deliver state-of-the-art, high precision, hallucination-free, structured, and visually stunning technical responses.
Use GitHub Flavored Markdown (GFM) with rich headers, tables, bullet points, clean formatting, and copyable code fences.
You have memory of all prior messages and files shared in this conversation. Relate new answers to previous context and discussions.
When external web links or attached files are provided in the context, thoroughly read, validate, and reference their contents in your response.

FLOWCHART & DIAGRAM GENERATION CAPABILITIES:
When asked to create or generate a flowchart, architecture diagram, workflow, or system visualization (or when relevant), ALWAYS output a clean, syntactically valid GFM Mermaid diagram block:
\`\`\`mermaid
graph TD
  A["Step 1: Input"] --> B["Step 2: Processing"]
  B --> C{"Decision Point?"}
  C -->|Yes| D["Success Outcome"]
  C -->|No| E["Alternative / Fallback"]
\`\`\`
You support all primary flowchart paradigms:
1. Process flow diagrams (step-by-step sequence of tasks, inputs, decisions, and outcomes)
2. Workflow diagrams (team actions, handoffs, and approval paths)
3. Data flow diagrams (DFD - external entities, processes, data stores, data streams)
4. Swimlane flowcharts (cross-functional lanes per role/team using subgraph LaneName ... end)
5. Decision tree diagrams (binary/multi-way branching logic with Yes/No paths)
6. System flowcharts (software modules, APIs, databases, message queues)
7. Document flowcharts (drafting, review, sign-off, multi-stage approval)
8. Product flowcharts (design, materials, fabrication, QA, packaging, delivery)
9. PERT charts (project milestones, task dependencies, critical paths)
10. Use case flowcharts (user actors, system boundaries, interaction flows)
11. Event storming flowcharts (domain events, command triggers, aggregate models)
12. Customer journey flowcharts (awareness, consideration, purchase, retention)
13. Production flowcharts (order fulfillment pipeline, supply chain)
14. Logical model flowcharts (inputs -> activities -> outputs -> outcomes)
15. Code flowcharts (algorithms, conditionals, loops, functions)
16. E-commerce flowcharts (cart, checkout, payment gateway, inventory, dispatch)
17. Website flowcharts (sitemaps, page hierarchy, routing)

CHARTS & ANALYTICS VISUALIZATION CAPABILITIES:
When the user asks for charts, graphs, metrics, trends, distributions, or statistical visualizations (or when analytics are helpful), output a rich, interactable Chart code block using the \`chart\` or \`json-chart\` format:
\`\`\`chart
{
  "type": "area",
  "title": "Monthly Active Users and Teams",
  "subtitle": "Growth trajectory over Q1-Q4",
  "xAxisKey": "month",
  "dataKeys": [
    { "key": "users", "label": "Active Users", "color": "#6366F1" },
    { "key": "teams", "label": "Created Teams", "color": "#06B6D4" }
  ],
  "data": [
    { "month": "Jan", "users": 420, "teams": 85 },
    { "month": "Feb", "users": 680, "teams": 140 },
    { "month": "Mar", "users": 1100, "teams": 230 },
    { "month": "Apr", "users": 1850, "teams": 390 }
  ]
}
\`\`\`
Supported chart types:
- "area": Smooth gradient area curves for trends over time
- "line": Multi-series trend lines with points
- "bar" / "column": Categorical bar or column comparisons
- "stacked-bar": Segmented multi-metric stacked bars
- "pie" / "donut": Proportions and percentage distributions
- "radar": Multi-variable spider evaluation
- "pareto": Frequency bars + cumulative percentage curve
- "kpi": Executive single-metric card with targets and sparklines
- "sparkline": Compact KPI trendline
- "geo-bubble": Regional / geographic distribution bubbles
- "histogram": Frequency distribution bins`;

  if (!pluginTitle) return basePrompt;

  if (pluginTitle === 'Flowchart Suite' || pluginTitle === 'Workflow Diagram' || pluginTitle === 'Architecture Diagram') {
    return `${basePrompt}

You are operating in [${pluginTitle} Plugin Mode].
Deliver a comprehensive, visually rich diagram tailored to the user's specific flowchart type requirement (or select the best flowchart type if unspecified).
ALWAYS provide the complete, syntactically clean GFM Mermaid diagram block (e.g. \`\`\`mermaid ... \`\`\`), followed by a clear structural walkthrough of every stage, role handoff, decision logic, and optimization points.`;
  }

  if (pluginTitle === 'Interactive Charts & Graphs') {
    return `${basePrompt}

You are operating in [Interactive Charts & Graphs Plugin Mode].
Provide a comprehensive analytics breakdown and ALWAYS include one or more interactive \`\`\`chart ... \`\`\` code blocks using the specified JSON schema. Select the optimal visualization type (area, bar, stacked-bar, radar, pareto, donut, pie, kpi, sparkline, geo-bubble, histogram) based on the user's dataset or generate a realistic, representative benchmark dataset with realistic trends.`;
  }

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
        timeout: 8000,
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
 * Stream output from Gemini via SSE with candidate model fallback
 */
async function callGeminiGenerateStream({ contents, systemInstruction, onChunk, abortSignal }) {
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    if (abortSignal?.aborted) {
      return { text: '', modelUsed: model, aborted: true };
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;
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
        responseType: 'stream',
        timeout: 10000,
      });

      let fullAccumulatedText = '';
      let streamHasStarted = false;

      const streamPromise = new Promise((resolve, reject) => {
        let buffer = '';

        const onAbort = () => {
          try {
            res.data?.destroy();
          } catch {}
          resolve({ text: fullAccumulatedText, modelUsed: model, aborted: true });
        };

        if (abortSignal) {
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        res.data.on('data', (chunk) => {
          if (abortSignal?.aborted) return;
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.candidates && parsed.candidates.length > 0) {
                  const candidate = parsed.candidates[0];
                  const textParts = candidate.content?.parts?.map((p) => p.text).filter(Boolean) || [];
                  const textChunk = textParts.join('');
                  if (textChunk) {
                    streamHasStarted = true;
                    fullAccumulatedText += textChunk;
                    if (onChunk) {
                      onChunk({
                        chunk: textChunk,
                        fullText: fullAccumulatedText,
                        modelUsed: model,
                      });
                    }
                  }
                }
              } catch (e) {
                // Ignore incomplete SSE chunk parse error
              }
            }
          }
        });

        res.data.on('end', () => {
          if (buffer.trim().startsWith('data:')) {
            const jsonStr = buffer.trim().slice(5).trim();
            if (jsonStr && jsonStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.candidates && parsed.candidates.length > 0) {
                  const textParts = parsed.candidates[0].content?.parts?.map((p) => p.text).filter(Boolean) || [];
                  const textChunk = textParts.join('');
                  if (textChunk) {
                    fullAccumulatedText += textChunk;
                    if (onChunk) {
                      onChunk({
                        chunk: textChunk,
                        fullText: fullAccumulatedText,
                        modelUsed: model,
                      });
                    }
                  }
                }
              } catch {}
            }
          }
          resolve({ text: fullAccumulatedText, modelUsed: model, aborted: false });
        });

        res.data.on('error', (err) => {
          if (streamHasStarted) {
            // If already streaming, resolve with whatever partial text was gathered
            resolve({ text: fullAccumulatedText, modelUsed: model, aborted: false });
          } else {
            reject(err);
          }
        });
      });

      const result = await streamPromise;
      if (result.text || result.aborted) {
        return result;
      }
    } catch (err) {
      console.warn(`[geminiService stream] Model ${model} failed (${err.response?.status || err.message}), trying next fallback...`);
      lastError = err;
      if (err.response?.status !== 404 && err.response?.status !== 429) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  throw new Error(
    lastError?.response?.data?.error?.message ||
      lastError?.message ||
      'All Gemini models failed to stream response'
  );
}

/**
 * Shared helper to build full prompt context, scrape URLs, attach multimodal files, and structure history
 */
async function buildPromptContextAndContents({
  prompt,
  conversationHistory = [],
  pluginTitle = null,
  fileContext = null,
  webUrls = [],
}) {
  const systemInstruction = getSystemPrompt(pluginTitle);

  // Extract URLs from prompt & explicit webUrls list
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"'{}|\\^`]+/gi;
  const foundUrls = prompt.match(urlRegex) || [];
  const allUrlsToScrape = Array.from(new Set([...(webUrls || []), ...foundUrls])).filter((u) => {
    return (
      !u.endsWith('.png') &&
      !u.endsWith('.jpg') &&
      !u.endsWith('.jpeg') &&
      !u.endsWith('.gif') &&
      !u.endsWith('.pdf') &&
      u.length > 5
    );
  });

  // Parallel fast scraping (max 3 URLs with 3.5s timeout)
  let scrapedContextText = '';
  if (allUrlsToScrape.length > 0) {
    const scrapeResults = await Promise.allSettled(
      allUrlsToScrape.slice(0, 3).map((u) => scrapeWebPage(u))
    );
    for (const res of scrapeResults) {
      if (res.status === 'fulfilled' && res.value && res.value.content) {
        scrapedContextText += `\n\n=== SCRAPED WEB LINK CONTENT: ${res.value.title} (${res.value.url}) ===\n${res.value.content}\n=== END OF SCRAPED WEB LINK CONTENT ===\n`;
      }
    }
  }

  // Build context injection for current turn
  let fileContextText = '';
  if (fileContext) {
    const filename = fileContext.filename || fileContext.name || 'file';
    const rawMime = fileContext.mimeType || fileContext.type || '';
    const normalizedMime = normalizeMimeType(rawMime, filename);

    if (normalizedMime.startsWith('audio/')) {
      fileContextText = `\n\n=== ATTACHED AUDIO FILE: "${filename}" (${normalizedMime}) ===\n[INSTRUCTION: The user has attached an audio recording. Listen carefully to the entire audio clip. Provide a complete transcription / speech breakdown, identify key topics, speakers, sound cues, musical elements or voice nuances if applicable, summarize core takeaways, and fulfill the user request based on this audio recording.]\n=== END OF ATTACHED AUDIO FILE ===\n`;
    } else if (normalizedMime.startsWith('video/')) {
      fileContextText = `\n\n=== ATTACHED VIDEO FILE: "${filename}" (${normalizedMime}) ===\n[INSTRUCTION: The user has attached a video recording. Thoroughly analyze both the visual video stream and the audio track across all frames and timestamps. Provide scene descriptions, summarize the presentation / code demonstration / visual actions, extract key discussion points, and fulfill the user request based on this video.]\n=== END OF ATTACHED VIDEO FILE ===\n`;
    } else if (fileContext.extractedText) {
      fileContextText = `\n\n=== ATTACHED FILE CONTEXT: "${filename}" (${normalizedMime || 'text'}) ===\n${fileContext.extractedText}\n=== END OF ATTACHED FILE CONTEXT ===\n`;
    } else if (filename) {
      fileContextText = `\n\n[Attached File: "${filename}" (${normalizedMime || 'media'})]\n`;
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

  for (const msg of conversationHistory) {
    if (msg.text === prompt && msg.sender === 'user') {
      continue;
    }

    const role = msg.sender === 'user' ? 'user' : 'model';
    const textContent = msg.text || '';

    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts.push({ text: textContent });
    } else {
      contents.push({
        role,
        parts: [{ text: textContent }],
      });
    }
  }

  const currentParts = [];

  if (fileContext && fileContext.base64Data) {
    const filename = fileContext.filename || fileContext.name || '';
    const rawMime = fileContext.mimeType || fileContext.type || '';
    const normalizedMime = normalizeMimeType(rawMime, filename);

    const isMultimodal =
      normalizedMime.startsWith('image/') ||
      normalizedMime.startsWith('audio/') ||
      normalizedMime.startsWith('video/') ||
      normalizedMime === 'application/pdf';

    if (isMultimodal) {
      const cleanBase64 = fileContext.base64Data.replace(/^data:[^;]+;base64,/, '');
      currentParts.push({
        inlineData: {
          mimeType: normalizedMime,
          data: cleanBase64,
        },
      });
    }
  }

  currentParts.push({ text: enrichedUserPrompt });

  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts.push(...currentParts);
  } else {
    contents.push({
      role: 'user',
      parts: currentParts,
    });
  }

  return { contents, systemInstruction };
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
  const { contents, systemInstruction } = await buildPromptContextAndContents({
    prompt,
    conversationHistory,
    pluginTitle,
    fileContext,
    webUrls,
  });

  const result = await callGeminiGenerate({ contents, systemInstruction });
  return result;
}

/**
 * Real-time streaming prompt processing pipeline
 */
async function processAiChatStream({
  prompt,
  conversationHistory = [],
  pluginTitle = null,
  fileContext = null,
  webUrls = [],
  onChunk,
  abortSignal,
}) {
  const { contents, systemInstruction } = await buildPromptContextAndContents({
    prompt,
    conversationHistory,
    pluginTitle,
    fileContext,
    webUrls,
  });

  const result = await callGeminiGenerateStream({
    contents,
    systemInstruction,
    onChunk,
    abortSignal,
  });

  return result;
}

module.exports = {
  callGeminiGenerate,
  callGeminiGenerateStream,
  scrapeWebPage,
  extractPdfText,
  processAiChat,
  processAiChatStream,
};
