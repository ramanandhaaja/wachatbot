const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();
app.use(cors());

const sessions = new Map();
const QR_TIMEOUT = 30000; // 3 minutes timeout for QR code scanning

const getSession = (id) => {
  return sessions.get(id);
};

const setSession = (id, data) => {
  sessions.set(id, { ...data, id });
};

const deleteSession = async (id) => {
  try {
    const session = getSession(id);
    if (session?.client) {
      // Gracefully destroy the client
      await session.client.destroy();
      // Give a small delay for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error(`Error during session cleanup for ${id}:`, error);
  } finally {
    // Always remove from sessions map
    sessions.delete(id);
  }
}; 

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const indexRouter = require("./routes");
app.use("/", indexRouter);

// Create a session for each user
const createSession = async (id) => {
  // Check if session already exists
  const existingSession = getSession(id);
  if (existingSession?.client) {
    console.log(`Session ${id} already exists`);
    return existingSession;
  }

  const client = new Client({
    puppeteer: { headless: true },
    authStrategy: new LocalAuth({ clientId: id }),
  });

  // Initialize session state
  setSession(id, {
    client,
    qr: null,
    ready: false,
    lastActivity: Date.now(),
    retryCount: 0,
    state: 'INITIALIZING',
    hasGeneratedQR: false
  });

  // Set up event handlers
  let qrTimeout;
  
  client.on("qr", (qr) => {
    console.log(`QR for ${id}: ${qr}`);
    const session = getSession(id);
    if (session && !session.hasGeneratedQR) {
      // Update session with QR flag
      setSession(id, { ...session, hasGeneratedQR: true });
      
      // Set timeout to destroy session if QR not scanned
      if (qrTimeout) clearTimeout(qrTimeout);
      qrTimeout = setTimeout(async () => {
        console.log(`QR code timeout for session ${id}`);
        const currentSession = getSession(id);
        if (currentSession?.state === 'QR_READY' && !currentSession.ready) {
          console.log(`Destroying session ${id} due to QR timeout`);
          await deleteSession(id);
        }
      }, QR_TIMEOUT);
      
      setSession(id, { ...session, qr, state: 'QR_READY' });
    }
  });

  client.on("ready", () => {
    console.log(`Client ${id} is ready`);
    // Clear QR timeout when successfully connected
    if (qrTimeout) {
      clearTimeout(qrTimeout);
      qrTimeout = null;
    }
    
    const session = getSession(id);
    if (session) {
      // Keep hasGeneratedQR flag but update other state
      setSession(id, { 
        ...session, 
        ready: true, 
        qr: null, 
        state: 'CONNECTED'
      });
    }
  });

  client.on("disconnected", async (reason) => {
    console.log(`Client ${id} disconnected:`, reason);
    const session = getSession(id);
    if (session) {
      try {
        // Update session state first
        setSession(id, { ...session, ready: false, state: 'DISCONNECTED', qr: null });
        
        // Destroy the client properly
        await client.destroy();
        // Remove client from sessions
        delete sessions[id];
        console.log(`Client ${id} cleaned up successfully`);
      } catch (err) {
        console.error(`Error cleaning up client ${id}:`, err);
      }
    }
  });

  client.on("auth_failure", async (msg) => {
    console.error(`Auth failure for client ${id}:`, msg);
    const session = getSession(id);
    if (session) {
      setSession(id, { ...session, ready: false, state: 'DISCONNECTED' });
      // Clean up the session on auth failure
      await deleteSession(id);
    }
  });

  client.on("message", async (message) => {
    const session = getSession(id);
    if (!session?.ready) {
      console.log(`Ignoring message for inactive session ${id}`);
      return;
    }

    console.log(`[Session ${id}] Message from ${message.from}: ${message.body}`);
    try {
      const reply = "Thank you for your message! We'll get back to you soon.";
      await client.sendMessage(message.from, reply);
      console.log(`[Session ${id}] Auto-reply sent to ${message.from}`);
      
      // Update last activity
      setSession(id, { ...session, lastActivity: Date.now() });
    } catch (error) {
      console.error(`[Session ${id}] Error sending auto-reply:`, error);
    }
  });


  try {
    await client.initialize();
    return getSession(id);
  } catch (error) {
    console.error(`Error initializing session ${id}:`, error);
    deleteSession(id);
    throw error;
  }
};

// Get session status
app.get("/session/:id/status", async (req, res) => {
  const { id } = req.params;
  const session = getSession(id);

  if (!session) {
    return res.json({
      success: false,
      state: 'DISCONNECTED',
      qr: null,
      message: 'No active session'
    });
  }

  return res.json({
    success: true,
    state: session.state,
    qr: session.qr,
    message: session.state === 'CONNECTED' ? 'WhatsApp is connected' :
             session.state === 'QR_READY' ? 'Please scan the QR code' :
             session.state === 'INITIALIZING' ? 'Initializing WhatsApp' :
             'Session is disconnected'
  });
});

// Start a session for a user
app.post("/start-session", async (req, res) => {
  let id;
  try {
    id = req.body.id;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing id in request body'
      });
    }

    // Clean up any existing session first
    const existingSession = getSession(id);
    if (existingSession) {
      console.log(`Cleaning up existing session for ${id}`);
      await deleteSession(id);
      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await createSession(id);

    // Get initial session state
    const session = getSession(id);
    
    // If client is already ready, return success
    if (session?.ready) {
      return res.json({
        success: true,
        state: 'CONNECTED',
        message: 'WhatsApp is connected'
      });
    }

    // Wait for QR code only if not ready
    let attempts = 0;
    while (!getSession(id)?.qr && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    // Get updated session state
    const updatedSession = getSession(id);
    if (updatedSession?.qr) {
      res.json({
        success: true,
        state: 'QR_READY',
        qr: updatedSession.qr,
        message: 'Please scan the QR code'
      });
    } else if (updatedSession?.ready) {
      res.json({
        success: true,
        state: 'CONNECTED',
        message: 'WhatsApp is connected'
      });
    } else {
      res.json({
        success: true,
        state: 'INITIALIZING',
        message: 'Initializing WhatsApp'
      });
    }
  } catch (error) {
    console.error('Error initializing WhatsApp client:', error);
    await deleteSession(id);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize WhatsApp client',
      details: error.message
    });
  }
});




// Send a message from a user session
app.post("/send-message", async (req, res) => {
  const { id, to, message } = req.body;
  if (!sessions[id] || !sessions[id].ready)
    return res.status(400).json({ message: "Session not ready" });

  try {
    await sessions[id].client.sendMessage(to, message);
    res.json({ message: "Message sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = app;
