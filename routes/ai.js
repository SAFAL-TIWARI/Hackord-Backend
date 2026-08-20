const express = require('express');
const router = express.Router();
const AiConversation = require('../models/AiConversation');
const AiFile = require('../models/AiFile');
const { processAiChat, processAiChatStream, scrapeWebPage, extractPdfText } = require('../services/geminiService');

// -------------------------------------------------------------
// GET /api/ai/conversations - List conversations for a room (Visible to all room members)
// -------------------------------------------------------------
router.get('/conversations', async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!roomId) {
      return res.status(400).json({ error: 'roomId query parameter is required' });
    }

    // Fetch conversations sorted by pinned & updated timestamp
    const conversations = await AiConversation.find({ roomId })
      .sort({ pinned: -1, updatedAt: -1 })
      .lean();

    // Optimize payload: keep lightweight metadata for listing, strip giant multi-MB dataUrl
    // (full dataUrl will be retrieved on-demand via GET /api/ai/files/:id when opened)
    const optimized = conversations.map((conv) => ({
      ...conv,
      messages: (conv.messages || []).map((msg) => {
        if (!msg.fileAttachment) return msg;
        const att = msg.fileAttachment;
        return {
          ...msg,
          fileAttachment: {
            id: att.id || 'file-' + Date.now(),
            name: att.name,
            size: att.size,
            type: att.type,
            extractedText: att.extractedText ? att.extractedText.slice(0, 500) : '',
            uploadedAt: att.uploadedAt,
            author_name: att.author_name,
            author_id: att.author_id,
            dataUrl: '',
            hasFullData: true,
          },
        };
      }),
    }));

    res.json(optimized);
  } catch (err) {
    console.error('[ai api] GET /conversations error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch AI conversations' });
  }
});

// -------------------------------------------------------------
// GET /api/ai/files/:id - Fetch full file dataUrl on demand
// -------------------------------------------------------------
router.get('/files/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Check dedicated AiFile collection first
    const fileDoc = await AiFile.findOne({ id }).lean();
    if (fileDoc && fileDoc.base64Data) {
      return res.json({
        id: fileDoc.id,
        name: fileDoc.filename,
        type: fileDoc.mimeType,
        size: fileDoc.fileSize,
        dataUrl: fileDoc.base64Data,
        extractedText: fileDoc.extractedText || '',
      });
    }

    // 2. Fallback to AiConversation
    const conv = await AiConversation.findOne({ 'messages.fileAttachment.id': id }).lean();
    if (conv) {
      for (const msg of conv.messages) {
        if (msg.fileAttachment && msg.fileAttachment.id === id) {
          return res.json({
            id: msg.fileAttachment.id,
            name: msg.fileAttachment.name,
            type: msg.fileAttachment.type,
            size: msg.fileAttachment.size,
            dataUrl: msg.fileAttachment.dataUrl || '',
            extractedText: msg.fileAttachment.extractedText || '',
          });
        }
      }
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (err) {
    console.error('[ai api] GET /files/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/conversations - Create a new AI conversation
// -------------------------------------------------------------
router.post('/conversations', async (req, res) => {
  try {
    const { roomId, userId, userName, userAvatar, title, activePlugin } = req.body;
    if (!roomId || !userId) {
      return res.status(400).json({ error: 'roomId and userId are required' });
    }

    const newId = 'chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const initialTitle = title || (activePlugin ? activePlugin + ' Workspace' : 'New Conversation');

    const conversation = await AiConversation.create({
      id: newId,
      roomId,
      userId,
      author_name: userName || 'User',
      author_avatar: userAvatar || '',
      title: initialTitle,
      pinned: false,
      activePlugin: activePlugin || null,
      messages: [
        {
          id: 'msg-welcome-' + Date.now(),
          sender: 'ai',
          text: activePlugin
            ? `Welcome to **${activePlugin}** mode! Ask questions, generate diagrams, or provide project requirements to begin.`
            : 'Hello! I am your AI Workspace assistant. Ask questions, generate presentations, diagrams, READMEs, or attach files for instant analysis.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toISOString().split('T')[0],
          plugin: activePlugin || null,
        },
      ],
    });

    res.status(201).json(conversation);
  } catch (err) {
    console.error('[ai api] POST /conversations error:', err);
    res.status(500).json({ error: err.message || 'Failed to create AI conversation' });
  }
});

// -------------------------------------------------------------
// PUT /api/ai/conversations/:id - Update conversation (rename, pin, activePlugin)
// -------------------------------------------------------------
router.put('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, activePlugin } = req.body;

    const updates = {};
    if (typeof title === 'string') updates.title = title.trim();
    if (typeof pinned === 'boolean') updates.pinned = pinned;
    if (activePlugin !== undefined) updates.activePlugin = activePlugin;
    updates.updatedAt = new Date();

    const conversation = await AiConversation.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (err) {
    console.error('[ai api] PUT /conversations/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to update AI conversation' });
  }
});

// -------------------------------------------------------------
// DELETE /api/ai/conversations/:id - Delete conversation
// -------------------------------------------------------------
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await AiConversation.findOneAndDelete({ id });
    if (!result) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error('[ai api] DELETE /conversations/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete AI conversation' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/upload - Handle file upload, deduplication & analysis
// -------------------------------------------------------------
router.post('/upload', async (req, res) => {
  try {
    const { roomId, userId, userName, filename, mimeType, fileSize, base64Data } = req.body;

    if (!filename || !base64Data) {
      return res.status(400).json({ error: 'filename and base64Data are required' });
    }

    // Limit check: 5MB in bytes (approx 7MB in base64)
    const MAX_BASE64_LENGTH = 7 * 1024 * 1024;
    if (base64Data.length > MAX_BASE64_LENGTH) {
      return res.status(413).json({ error: 'File exceeds 5MB size limit' });
    }

    const calculatedSize = fileSize || Math.round((base64Data.length * 3) / 4);

    // Extract text from newly uploaded file
    let extractedText = '';
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    // Infer mime type if missing
    let resolvedMimeType = mimeType || 'application/octet-stream';
    const ext = (filename.toLowerCase().split('.').pop() || '').trim();
    if (resolvedMimeType === 'application/octet-stream') {
      if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
        resolvedMimeType = 'audio/' + (ext === 'mp3' ? 'mpeg' : ext);
      } else if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) {
        resolvedMimeType = ext === 'mov' ? 'video/quicktime' : 'video/' + ext;
      }
    }

    if (resolvedMimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      extractedText = await extractPdfText(buffer);
    } else if (
      resolvedMimeType?.startsWith('text/') ||
      filename.match(/\.(txt|md|marp|js|ts|tsx|jsx|json|html|css|py|java|cpp|c|csv|sql|yaml|yml|xml|env)$/i)
    ) {
      extractedText = buffer.toString('utf8');
    }

    const fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    // Store in dedicated AiFile collection
    await AiFile.findOneAndUpdate(
      { id: fileId },
      {
        id: fileId,
        roomId: roomId || 'default-room',
        userId: userId || 'default-user',
        filename,
        mimeType: resolvedMimeType || mimeType || 'application/octet-stream',
        fileSize: calculatedSize,
        extractedText: extractedText.slice(0, 50000),
        base64Data: base64Data,
      },
      { upsert: true, new: true }
    );

    res.status(201).json({
      success: true,
      isDuplicate: false,
      file: {
        id: fileId,
        name: filename,
        type: resolvedMimeType || mimeType || 'application/octet-stream',
        size: calculatedSize,
        dataUrl: base64Data, // returned to caller for immediate client preview
        extractedText: extractedText.slice(0, 50000),
        extractedTextPreview: extractedText ? extractedText.slice(0, 300) : '',
        author_name: userName || 'User',
        author_id: userId || '',
      },
    });
  } catch (err) {
    console.error('[ai api] POST /upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload and analyze file' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/scrape-link - Scrape any URL via cheerio for context
// -------------------------------------------------------------
router.post('/scrape-link', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url parameter is required' });
    }
    const result = await scrapeWebPage(url);
    res.json(result);
  } catch (err) {
    console.error('[ai api] POST /scrape-link error:', err);
    res.status(500).json({ error: err.message || 'Failed to scrape link' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/chat - Process message with Gemini & update MongoDB
// -------------------------------------------------------------
router.post('/chat', async (req, res) => {
  try {
    const {
      conversationId,
      roomId,
      userId,
      userName,
      userAvatar,
      prompt,
      pluginTitle,
      fileAttachment,
      webUrls,
    } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt text is required' });
    }

    let conversation = null;
    if (conversationId) {
      conversation = await AiConversation.findOne({ id: conversationId });
    }

    if (!conversation) {
      const newId = conversationId || 'chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const titlePrompt = prompt.trim().slice(0, 30) || 'New Conversation';
      conversation = new AiConversation({
        id: newId,
        roomId: roomId || 'default-room',
        userId: userId || 'default-user',
        author_name: userName || 'User',
        author_avatar: userAvatar || '',
        title: titlePrompt,
        pinned: false,
        activePlugin: pluginTitle || null,
        messages: [],
      });
    }

    // Build file context for Gemini & persist file to AiFile if full base64 was sent
    let fileContext = null;
    const fileId = fileAttachment?.id || (fileAttachment ? 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) : null);
    
    if (fileAttachment && (fileAttachment.name || fileAttachment.filename)) {
      let base64 = fileAttachment.dataUrl || fileAttachment.base64Data || '';
      
      // If base64 not in payload, check AiFile
      if (!base64 && fileAttachment.id) {
        const existingAiFile = await AiFile.findOne({ id: fileAttachment.id }).lean();
        if (existingAiFile) {
          base64 = existingAiFile.base64Data;
        }
      } else if (base64 && fileId) {
        // Save to AiFile collection to keep conversation lightweight
        await AiFile.findOneAndUpdate(
          { id: fileId },
          {
            id: fileId,
            roomId: roomId || 'default-room',
            userId: userId || 'default-user',
            filename: fileAttachment.name || fileAttachment.filename,
            mimeType: fileAttachment.type || fileAttachment.mimeType || 'application/octet-stream',
            fileSize: fileAttachment.size || fileAttachment.fileSize || 0,
            extractedText: fileAttachment.extractedText || '',
            base64Data: base64,
          },
          { upsert: true }
        );
      }

      fileContext = {
        filename: fileAttachment.name || fileAttachment.filename,
        mimeType: fileAttachment.type || fileAttachment.mimeType,
        extractedText: fileAttachment.extractedText || '',
        base64Data: base64,
      };
    }

    // Format user message with lightweight attachment (NO raw megabytes in conversation array)
    const now = new Date();
    const userMsg = {
      id: 'm-user-' + Date.now(),
      sender: 'user',
      author_name: userName || 'You',
      author_avatar: userAvatar || '',
      author_id: userId || '',
      text: prompt.trim(),
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: now.toISOString().split('T')[0],
      plugin: pluginTitle || null,
      fileAttachment: fileAttachment
        ? {
          id: fileId,
          name: fileAttachment.name || fileAttachment.filename,
          size: fileAttachment.size || fileAttachment.fileSize || 0,
          type: fileAttachment.type || fileAttachment.mimeType || 'application/octet-stream',
          dataUrl: '', // Keeps MongoDB document tiny
          extractedText: fileAttachment.extractedText ? fileAttachment.extractedText.slice(0, 500) : '',
          uploadedAt: new Date(),
          author_name: userName || 'You',
          author_id: userId || '',
        }
        : null,
    };

    // Keep snapshot of prior history before adding current message
    const priorHistory = [...conversation.messages];

    // Push user message to conversation
    conversation.messages.push(userMsg);

    // Call Gemini with full prior history & current prompt context
    const aiResult = await processAiChat({
      prompt: prompt.trim(),
      conversationHistory: priorHistory,
      pluginTitle,
      fileContext,
      webUrls: Array.isArray(webUrls) ? webUrls : [],
    });

    const aiMsg = {
      id: 'm-ai-' + Date.now(),
      sender: 'ai',
      author_name: 'Hackord AI Assistant',
      author_avatar: '',
      author_id: 'ai-assistant',
      text: aiResult.text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: now.toISOString().split('T')[0],
      plugin: pluginTitle || null,
      structuredData: {
        modelUsed: aiResult.modelUsed,
      },
    };

    conversation.messages.push(aiMsg);
    conversation.updatedAt = new Date();

    // Auto-update conversation title if it's default
    if (conversation.title === 'New Conversation' || conversation.messages.length <= 2) {
      const generatedTitle = prompt.trim().replace(/^[@/][\w-]+\s*/, '').slice(0, 32);
      if (generatedTitle) conversation.title = generatedTitle;
    }

    await conversation.save();

    res.json({
      conversation,
      userMessage: userMsg,
      aiMessage: aiMsg,
      modelUsed: aiResult.modelUsed,
    });
  } catch (err) {
    console.error('[ai api] POST /chat error:', err);
    res.status(500).json({ error: err.message || 'Failed to process AI chat message' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/chat/stream - Real-time word-by-word streaming output with Gemini & MongoDB persistence
// -------------------------------------------------------------
router.post('/chat/stream', async (req, res) => {
  const {
    conversationId,
    roomId,
    userId,
    userName,
    userAvatar,
    prompt,
    pluginTitle,
    fileAttachment,
    webUrls,
    editMessageId,
  } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt text is required' });
  }

  let conversation = null;
  if (conversationId) {
    conversation = await AiConversation.findOne({ id: conversationId });
  }

  if (!conversation) {
    const newId = conversationId || 'chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const titlePrompt = prompt.trim().slice(0, 30) || 'New Conversation';
    conversation = new AiConversation({
      id: newId,
      roomId: roomId || 'default-room',
      userId: userId || 'default-user',
      author_name: userName || 'User',
      author_avatar: userAvatar || '',
      title: titlePrompt,
      pinned: false,
      activePlugin: pluginTitle || null,
      messages: [],
    });
  }

  // Build file context for Gemini & persist file to AiFile if full base64 was sent
  let fileContext = null;
  const fileId = fileAttachment?.id || (fileAttachment ? 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) : null);

  if (fileAttachment && (fileAttachment.name || fileAttachment.filename)) {
    let base64 = fileAttachment.dataUrl || fileAttachment.base64Data || '';

    if (!base64 && fileAttachment.id) {
      const existingAiFile = await AiFile.findOne({ id: fileAttachment.id }).lean();
      if (existingAiFile) {
        base64 = existingAiFile.base64Data;
      }
    } else if (base64 && fileId) {
      await AiFile.findOneAndUpdate(
        { id: fileId },
        {
          id: fileId,
          roomId: roomId || 'default-room',
          userId: userId || 'default-user',
          filename: fileAttachment.name || fileAttachment.filename,
          mimeType: fileAttachment.type || fileAttachment.mimeType || 'application/octet-stream',
          fileSize: fileAttachment.size || fileAttachment.fileSize || 0,
          extractedText: fileAttachment.extractedText || '',
          base64Data: base64,
        },
        { upsert: true }
      );
    }

    fileContext = {
      filename: fileAttachment.name || fileAttachment.filename,
      mimeType: fileAttachment.type || fileAttachment.mimeType,
      extractedText: fileAttachment.extractedText || '',
      base64Data: base64,
    };
  }

  const now = new Date();
  let userMsg = null;
  let priorHistory = [];

  // Handle Editing the latest or specific user message
  if (editMessageId) {
    const existingMsgIndex = conversation.messages.findIndex((m) => m.id === editMessageId);
    if (existingMsgIndex !== -1) {
      // Prior history is everything before the edited message
      priorHistory = conversation.messages.slice(0, existingMsgIndex);

      // Update existing message
      conversation.messages[existingMsgIndex].text = prompt.trim();
      conversation.messages[existingMsgIndex].timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      conversation.messages[existingMsgIndex].date = now.toISOString().split('T')[0];
      if (pluginTitle !== undefined) conversation.messages[existingMsgIndex].plugin = pluginTitle || null;

      userMsg = conversation.messages[existingMsgIndex];

      // Remove the previous AI response that immediately followed this user message (if any)
      if (
        conversation.messages.length > existingMsgIndex + 1 &&
        conversation.messages[existingMsgIndex + 1].sender === 'ai'
      ) {
        conversation.messages.splice(existingMsgIndex + 1, 1);
      }
    }
  }

  if (!userMsg) {
    userMsg = {
      id: 'm-user-' + Date.now(),
      sender: 'user',
      author_name: userName || 'You',
      author_avatar: userAvatar || '',
      author_id: userId || '',
      text: prompt.trim(),
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: now.toISOString().split('T')[0],
      plugin: pluginTitle || null,
      fileAttachment: fileAttachment
        ? {
            id: fileId,
            name: fileAttachment.name || fileAttachment.filename,
            size: fileAttachment.size || fileAttachment.fileSize || 0,
            type: fileAttachment.type || fileAttachment.mimeType || 'application/octet-stream',
            dataUrl: '',
            extractedText: fileAttachment.extractedText ? fileAttachment.extractedText.slice(0, 500) : '',
            uploadedAt: new Date(),
            author_name: userName || 'You',
            author_id: userId || '',
          }
        : null,
    };

    priorHistory = [...conversation.messages];
    conversation.messages.push(userMsg);
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Prevent Nginx / proxy buffering
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const aiMsgId = 'm-ai-' + Date.now();

  // Send initial start event
  res.write(
    `data: ${JSON.stringify({
      type: 'start',
      conversationId: conversation.id,
      userMessage: userMsg,
      aiMessageId: aiMsgId,
    })}\n\n`
  );

  const abortController = new AbortController();
  let clientDisconnected = false;
  let fullAccumulatedText = '';
  let modelUsedName = 'gemini-3.7-flash';

  req.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
  });

  try {
    const streamResult = await processAiChatStream({
      prompt: prompt.trim(),
      conversationHistory: priorHistory,
      pluginTitle,
      fileContext,
      webUrls: Array.isArray(webUrls) ? webUrls : [],
      onChunk: ({ chunk, fullText, modelUsed }) => {
        fullAccumulatedText = fullText;
        if (modelUsed) modelUsedName = modelUsed;
        if (!clientDisconnected) {
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              text: chunk,
              fullText,
              modelUsed,
            })}\n\n`
          );
        }
      },
      abortSignal: abortController.signal,
    });

    const finalAiText = fullAccumulatedText || streamResult?.text || '';

    const aiMsg = {
      id: aiMsgId,
      sender: 'ai',
      author_name: 'Hackord AI Assistant',
      author_avatar: '',
      author_id: 'ai-assistant',
      text: finalAiText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: now.toISOString().split('T')[0],
      plugin: pluginTitle || null,
      structuredData: {
        modelUsed: modelUsedName || streamResult?.modelUsed || 'gemini-3.7-flash',
      },
    };

    conversation.messages.push(aiMsg);
    conversation.updatedAt = new Date();

    if (conversation.title === 'New Conversation' || conversation.messages.length <= 2) {
      const generatedTitle = prompt.trim().replace(/^[@/][\w-]+\s*/, '').slice(0, 32);
      if (generatedTitle) conversation.title = generatedTitle;
    }

    await conversation.save();

    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          conversation,
          userMessage: userMsg,
          aiMessage: aiMsg,
          modelUsed: modelUsedName,
        })}\n\n`
      );
      res.end();
    }
  } catch (err) {
    console.error('[ai api stream] error:', err);

    // If partial text was gathered before error or abort, still persist to MongoDB
    if (fullAccumulatedText) {
      try {
        const aiMsg = {
          id: aiMsgId,
          sender: 'ai',
          author_name: 'Hackord AI Assistant',
          author_avatar: '',
          author_id: 'ai-assistant',
          text: fullAccumulatedText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: now.toISOString().split('T')[0],
          plugin: pluginTitle || null,
          structuredData: {
            modelUsed: modelUsedName,
          },
        };
        conversation.messages.push(aiMsg);
        conversation.updatedAt = new Date();
        await conversation.save();
      } catch (saveErr) {
        console.error('[ai api stream] failed to save partial response:', saveErr);
      }
    }

    if (!clientDisconnected) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: err.message || 'Stream generation failed',
        })}\n\n`
      );
      res.end();
    }
  }
});

// -------------------------------------------------------------
// PUT /api/ai/conversations/:id/messages/:msgId - Edit specific message in conversation
// -------------------------------------------------------------
router.put('/conversations/:id/messages/:msgId', async (req, res) => {
  try {
    const { id, msgId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const conversation = await AiConversation.findOne({ id });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const message = conversation.messages.find((m) => m.id === msgId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    message.text = text.trim();
    message.timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    conversation.updatedAt = new Date();

    await conversation.save();

    res.json({ success: true, conversation, message });
  } catch (err) {
    console.error('[ai api] PUT message error:', err);
    res.status(500).json({ error: err.message || 'Failed to update message' });
  }
});

module.exports = router;
