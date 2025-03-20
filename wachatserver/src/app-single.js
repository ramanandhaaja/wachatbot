const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
const indexRouter = require('./routes');
app.use('/', indexRouter);

// Create WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
      args: ['--no-sandbox']
  }
});

let isClientReady = false;
let isResetting = false;
let qrCode = null;
let clientState = 'DISCONNECTED'; // possible states: DISCONNECTED, CONNECTING, READY

// Function to reset WhatsApp client
async function resetWhatsAppClient(forceNewQR = false) {
    try {
        isResetting = true;
        isClientReady = false;
        
        if (forceNewQR) {
            // Completely destroy the client and require new QR scan
            if (client) {
                await client.destroy();
                console.log('WhatsApp client destroyed, new QR code will be generated');
            }
        } else {
            // Just logout and reconnect, preserving session data
            if (client) {
                await client.logout();
                console.log('WhatsApp client logged out');
            }
        }
        
        // Initialize the client again
        await client.initialize();
        console.log('WhatsApp client reinitialized');
        
        isResetting = false;
        return true;
    } catch (error) {
        console.error('Error resetting WhatsApp client:', error);
        isResetting = false;
        return false;
    }
}

// Client status logging
const logStatus = () => {
    console.log('\n=== WhatsApp Client Status ===');
    console.log('State:', clientState);
    console.log('Ready:', isClientReady);
    console.log('QR Code:', qrCode ? 'Available' : 'Not Available');
    console.log('============================\n');
};

client.on('qr', (qr) => {
    console.log('\n🔄 New QR Code received. Waiting for scan...');
    qrCode = qr;
    clientState = 'CONNECTING';
    logStatus();
});

client.on('ready', () => {
    console.log('\n✅ WhatsApp client is ready!');
    isClientReady = true;
    clientState = 'READY';
    qrCode = null;
    logStatus();
});

client.on('auth_failure', () => {
    console.log('\n❌ Authentication failed!');
    isClientReady = false;
    clientState = 'DISCONNECTED';
    qrCode = null;
    logStatus();
});

client.on('disconnected', () => {
    console.log('\n🔌 Client disconnected!');
    isClientReady = false;
    clientState = 'DISCONNECTED';
    qrCode = null;
    logStatus();
});

client.on('loading_screen', (percent, message) => {
    console.log(`\n⏳ Loading: ${percent}% - ${message}`);
});

// Message handler for auto-reply
client.on('message', async (message) => {
  try {
      await message.reply('thanks');
      console.log('Auto-replied to message from:', message.from);
  } catch (error) {
      console.error('Error auto-replying to message:', error);
  }
});

// Initialize endpoint
app.post('/api/initialize', async (req, res) => {
    try {
        if (clientState === 'DISCONNECTED') {
            // Start initialization only if disconnected
            clientState = 'CONNECTING';
            client.initialize();
            
            // Wait for QR code or ready state
            let attempts = 0;
            while (!qrCode && !isClientReady && attempts < 20) {
                await new Promise(resolve => setTimeout(resolve, 500));
                attempts++;
            }

            if (isClientReady) {
                res.json({
                    success: true,
                    state: clientState,
                    message: 'WhatsApp client is ready'
                });
            } else if (qrCode) {
                res.json({
                    success: true,
                    state: clientState,
                    qrCode: qrCode,
                    message: 'Please scan the QR code'
                });
            } else {
                throw new Error('Timeout waiting for QR code or client ready');
            }
        } else {
            // Return current state if already initializing or ready
            res.json({
                success: true,
                state: clientState,
                qrCode: qrCode,
                message: clientState === 'READY' ? 'WhatsApp client is ready' : 'Please scan the QR code'
            });
        }
    } catch (error) {
        console.error('Error initializing WhatsApp client:', error);
        clientState = 'DISCONNECTED';
        res.status(500).json({
            success: false,
            error: 'Failed to initialize WhatsApp client',
            details: error.message
        });
    }
});

// Get client state endpoint
app.get('/api/state', (req, res) => {
    res.json({
        success: true,
        state: clientState,
        qrCode: qrCode,
        isReady: isClientReady
    });
});

// API Endpoints
app.post('/api/send-message', async (req, res) => {
  try {
      const { message } = req.body;
      
      if (!isClientReady) {
          return res.status(503).json({ 
              error: 'WhatsApp client not ready. Please scan the QR code first.' 
          });
      }

      const phoneNumber = '6281905101145';
      const chatId = phoneNumber + "@c.us";
      
      await client.sendMessage(chatId, message);
      res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ 
          error: 'Failed to send message', 
          details: error.message 
      });
  }
});

// Reset endpoint
app.post('/api/reset-connection', async (req, res) => {
    const { forceNewQR = false } = req.body; // Optional parameter to force new QR code
    try {
        if (isResetting) {
            return res.status(409).json({
                error: 'Reset already in progress'
            });
        }

        const success = await resetWhatsAppClient(forceNewQR);
        
        if (success) {
            res.json({
                success: true,
                message: 'WhatsApp client reset successfully. Please scan the new QR code.'
            });
        } else {
            res.status(500).json({
                error: 'Failed to reset WhatsApp client'
            });
        }
    } catch (error) {
        console.error('Error in reset endpoint:', error);
        res.status(500).json({
            error: 'Internal server error during reset',
            details: error.message
        });
    }
});

module.exports = app;
