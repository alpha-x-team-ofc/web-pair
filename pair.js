const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const router = express.Router();

// Ensure temp directory exists
const tempBaseDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempBaseDir)) {
    fs.mkdirSync(tempBaseDir, { recursive: true });
}

// Cleanup function
function removeFolder(folderPath) {
    try {
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`🧹 Cleaned: ${folderPath}`);
        }
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
}

// Store active sessions
const activeSessions = new Map();

router.get('/', async (req, res) => {
    const requestId = makeid(8);
    const phoneNumber = (req.query.number || '').replace(/\D/g, '');
    
    console.log(`📱 [${requestId}] Request for number: ${phoneNumber}`);
    
    if (!phoneNumber || phoneNumber.length < 10 || phoneNumber.length > 15) {
        return res.status(400).json({ 
            error: "Please provide a valid phone number (10-15 digits)" 
        });
    }
    
    // Send immediate response with pairing code
    try {
        const tempDir = path.join(tempBaseDir, requestId);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        const logger = pino({ level: 'fatal' });
        
        // Create socket for pairing code
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS("Safari"),
            syncFullHistory: false,
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Request pairing code
        if (!sock.authState.creds.registered) {
            await delay(1000);
            
            try {
                const pairingCode = await sock.requestPairingCode(phoneNumber);
                console.log(`✅ [${requestId}] Pairing code generated: ${pairingCode}`);
                
                // Store session info
                activeSessions.set(requestId, {
                    tempDir,
                    phoneNumber,
                    sock,
                    pairingCode,
                    timestamp: Date.now()
                });
                
                // Setup auto-cleanup after 10 minutes
                setTimeout(() => {
                    const session = activeSessions.get(requestId);
                    if (session) {
                        console.log(`⏰ [${requestId}] Auto-cleaning session`);
                        session.sock.ws?.close();
                        removeFolder(session.tempDir);
                        activeSessions.delete(requestId);
                    }
                }, 10 * 60 * 1000);
                
                // Setup connection handler for sending session ID
                setupConnectionHandler(sock, tempDir, phoneNumber, requestId);
                
                return res.json({ 
                    code: pairingCode,
                    message: "Use this code in WhatsApp > Linked Devices > Link a Device",
                    sessionId: requestId
                });
                
            } catch (pairErr) {
                console.error(`❌ [${requestId}] Pairing error:`, pairErr.message);
                removeFolder(tempDir);
                return res.status(500).json({ 
                    error: "Failed to generate pairing code",
                    details: pairErr.message 
                });
            }
        } else {
            removeFolder(tempDir);
            return res.status(400).json({ 
                error: "Already registered. Please use a new number or clear session." 
            });
        }
        
    } catch (err) {
        console.error(`🚨 [${requestId}] Setup error:`, err.message);
        return res.status(500).json({ 
            error: "Server error during setup",
            details: err.message 
        });
    }
});

// Function to setup connection handler for sending session ID
function setupConnectionHandler(sock, tempDir, phoneNumber, requestId) {
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
            console.log(`✅ [${requestId}] Connected to WhatsApp`);
            
            try {
                await delay(3000); // Wait for full connection
                
                // Get user info
                const user = sock.user;
                if (!user) {
                    throw new Error("User not found in connection");
                }
                
                // Read session files
                const sessionFiles = fs.readdirSync(tempDir);
                const sessionData = {};
                
                for (const file of sessionFiles) {
                    if (file.endsWith('.json')) {
                        const filePath = path.join(tempDir, file);
                        try {
                            const content = fs.readFileSync(filePath, 'utf8');
                            sessionData[file] = JSON.parse(content);
                        } catch (fileErr) {
                            console.error(`📁 [${requestId}] File read error ${file}:`, fileErr.message);
                        }
                    }
                }
                
                // Create session ID
                const base64Session = Buffer.from(JSON.stringify(sessionData)).toString('base64');
                const sessionId = `DTZ_NOVA_XMD_${requestId}_${base64Session.substring(0, 50)}`;
                
                console.log(`📤 [${requestId}] Session ID created`);
                
                // Send session ID to user
                await sock.sendMessage(user.id, {
                    text: `🔐 *DTZ NOVA XMD - Session Created*\n\n` +
                          `✅ *Your Session ID:*\n\`\`\`${sessionId}\`\`\`\n\n` +
                          `📱 *Save this ID* for future use\n` +
                          `⚠️ *Never share* this with anyone\n` +
                          `🔄 Use it to restore your session\n\n` +
                          `_Generated at: ${new Date().toLocaleString()}_`
                });
                
                console.log(`📨 [${requestId}] Session ID sent to ${user.id}`);
                
                // Send success message
                await sock.sendMessage(user.id, {
                    text: `🚀 *Connection Successful!*\n\n` +
                          `▸ Your WhatsApp is now connected to DTZ NOVA XMD\n` +
                          `▸ Session is active and ready to use\n` +
                          `▸ Check your messages for the Session ID\n\n` +
                          `🔗 *Useful Links:*\n` +
                          `▸ GitHub: https://github.com/alpha-x-team-ofc\n` +
                          `▸ Support: Contact Developer\n\n` +
                          `_Powered by ▶ ●───ᴅᴛᴢ ɴᴏᴠᴀ xᴍᴅ────▶ ●_`
                });
                
                // Save session info to file
                const sessionInfo = {
                    sessionId,
                    phoneNumber: user.id,
                    timestamp: new Date().toISOString(),
                    requestId
                };
                
                const infoPath = path.join(tempDir, 'session-info.json');
                fs.writeFileSync(infoPath, JSON.stringify(sessionInfo, null, 2));
                
            } catch (sendErr) {
                console.error(`❌ [${requestId}] Error sending session:`, sendErr.message);
                
                try {
                    await sock.sendMessage(sock.user?.id, {
                        text: `⚠️ *Error Creating Session*\n\n` +
                              `Error: ${sendErr.message}\n\n` +
                              `Please try again or contact support.`
                    });
                } catch (msgErr) {
                    console.error(`💬 [${requestId}] Could not send error message:`, msgErr.message);
                }
                
            } finally {
                // Cleanup after sending
                setTimeout(async () => {
                    console.log(`🔒 [${requestId}] Closing connection...`);
                    try {
                        sock.ws?.close();
                    } catch (closeErr) {
                        console.error(`❌ [${requestId}] Close error:`, closeErr.message);
                    }
                    
                    // Delay cleanup to ensure everything is sent
                    setTimeout(() => {
                        removeFolder(tempDir);
                        activeSessions.delete(requestId);
                        console.log(`🗑️ [${requestId}] Session cleaned up`);
                    }, 5000);
                }, 5000);
            }
            
        } else if (connection === "close") {
            console.log(`🔌 [${requestId}] Connection closed`);
            const session = activeSessions.get(requestId);
            
            // Only cleanup if not already cleaned
            if (session && Date.now() - session.timestamp < 9 * 60 * 1000) {
                removeFolder(session.tempDir);
                activeSessions.delete(requestId);
            }
        }
    });
}

// Session status endpoint
router.get('/status/:id', (req, res) => {
    const sessionId = req.params.id;
    const session = activeSessions.get(sessionId);
    
    if (session) {
        const age = Date.now() - session.timestamp;
        const files = fs.existsSync(session.tempDir) 
            ? fs.readdirSync(session.tempDir) 
            : [];
        
        res.json({
            status: 'active',
            age: `${Math.floor(age / 1000)}s`,
            phoneNumber: session.phoneNumber,
            filesCount: files.length,
            pairingCode: session.pairingCode
        });
    } else {
        res.status(404).json({ status: 'not_found' });
    }
});

// Cleanup all sessions endpoint (admin)
router.get('/cleanup', (req, res) => {
    const count = activeSessions.size;
    const now = Date.now();
    
    for (const [id, session] of activeSessions.entries()) {
        if (now - session.timestamp > 10 * 60 * 1000) {
            session.sock.ws?.close();
            removeFolder(session.tempDir);
            activeSessions.delete(id);
        }
    }
    
    res.json({ 
        message: `Cleaned up sessions. Active: ${activeSessions.size}`,
        cleaned: count - activeSessions.size
    });
});

module.exports = router;
