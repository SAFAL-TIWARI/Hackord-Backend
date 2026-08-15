const express = require('express');
const router = express.Router();
const AiConversation = require('../models/AiConversation');
const { processAiChat, scrapeWebPage, extractPdfText } = require('../services/geminiService');

// -------------------------------------------------------------
// GET /api/ai/conversations - List conversations for a room (Visible to all room members)
// -------------------------------------------------------------
router.get('/conversations', async (req, res) => {
  try {
    const { roomId } = req.query;
    if (!roomId) {
      return res.status(400).json({ error: 'roomId query parameter is required' });
    }

    // Conversations in a room are shared with all room members
    const conversations = await AiConversation.find({ roomId })
      .sort({ pinned: -1, updatedAt: -1 })
      .lean();

    res.json(conversations);
  } catch (err) {
    console.error('[ai api] GET /conversations error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch AI conversations' });
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
// PUT /api/ai/conversations/:id - Rename / Pin / Update
// -------------------------------------------------------------
router.put('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, pinned, activePlugin } = req.body;

    const conv = await AiConversation.findOne({ id });
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (typeof title === 'string' && title.trim()) conv.title = title.trim();
    if (typeof pinned === 'boolean') conv.pinned = pinned;
    if (activePlugin !== undefined) conv.activePlugin = activePlugin;

    await conv.save();
    res.json(conv);
  } catch (err) {
    console.error('[ai api] PUT /conversations/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to update conversation' });
  }
});

// -------------------------------------------------------------
// DELETE /api/ai/conversations/:id - Delete a conversation
// -------------------------------------------------------------
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await AiConversation.findOneAndDelete({ id });
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error('[ai api] DELETE /conversations/:id error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete conversation' });
  }
});

// -------------------------------------------------------------
// POST /api/ai/upload - Process single file (< 5MB) & deduplicate
// -------------------------------------------------------------
router.post('/upload', async (req, res) => {
  try {
    const { roomId, userId, userName, filename, mimeType, base64Data, fileSize } = req.body;

    if (!filename || !base64Data) {
      return res.status(400).json({ error: 'filename and base64Data are required' });
    }

    // 5MB maximum limit
    const MAX_BYTES = 5 * 1024 * 1024;
    const calculatedSize = fileSize || Math.round((base64Data.length * 3) / 4);
    if (calculatedSize > MAX_BYTES) {
      return res.status(400).json({
        error: 'File size exceeds the 5MB maximum limit. Please upload a file smaller than 5MB.',
      });
    }

    // Check if the exact same file was already uploaded in this room (within the last 24h)
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingConvWithFile = await AiConversation.findOne({
      roomId,
      'messages.fileAttachment.name': filename,
      'messages.fileAttachment.size': calculatedSize,
      'messages.createdAt': { $gte: cutoff24h },
    }).lean();

    if (existingConvWithFile) {
      for (const msg of existingConvWithFile.messages) {
        if (
          msg.fileAttachment &&
          msg.fileAttachment.name === filename &&
          msg.fileAttachment.size === calculatedSize
        ) {
          return res.json({
            success: true,
            isDuplicate: true,
            file: {
              id: msg.fileAttachment.id || 'file-' + Date.now(),
              name: msg.fileAttachment.name,
              type: msg.fileAttachment.type,
              size: msg.fileAttachment.size,
              dataUrl: msg.fileAttachment.dataUrl || base64Data,
              extractedText: msg.fileAttachment.extractedText || '',
              extractedTextPreview: msg.fileAttachment.extractedText
                ? msg.fileAttachment.extractedText.slice(0, 300)
                : '',
            },
          });
        }
      }
    }

    // Extract text from newly uploaded file
    let extractedText = '';
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      extractedText = await extractPdfText(buffer);
    } else if (
      mimeType?.startsWith('text/') ||
      filename.match(/\.(txt|md|marp|js|ts|tsx|jsx|json|html|css|py|java|cpp|c|csv|sql|yaml|yml|xml|env)$/i)
    ) {
      extractedText = buffer.toString('utf8');
    }

    const fileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

    res.status(201).json({
      success: true,
      isDuplicate: false,
      file: {
        id: fileId,
        name: filename,
        type: mimeType || 'application/octet-stream',
        size: calculatedSize,
        dataUrl: base64Data, // Persist for new tab open & viewing
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

    // Build file context for Gemini
    let fileContext = null;
    if (fileAttachment && (fileAttachment.name || fileAttachment.filename)) {
      fileContext = {
        filename: fileAttachment.name || fileAttachment.filename,
        mimeType: fileAttachment.type || fileAttachment.mimeType,
        extractedText: fileAttachment.extractedText || '',
        base64Data: fileAttachment.dataUrl || fileAttachment.base64Data || '',
      };
    }

    // Format user message with author info & date
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
          id: fileAttachment.id || 'file-' + Date.now(),
          name: fileAttachment.name || fileAttachment.filename,
          size: fileAttachment.size || fileAttachment.fileSize,
          type: fileAttachment.type || fileAttachment.mimeType,
          dataUrl: fileAttachment.dataUrl || fileAttachment.base64Data || '',
          extractedText: fileAttachment.extractedText || '',
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

module.exports = router;
