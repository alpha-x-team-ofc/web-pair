// Quick test to verify WhatsApp connection
const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function testPairing() {
    console.log('🧪 Testing WhatsApp pairing...');
    
    const tempDir = path.join(__dirname, 'test_session');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: state.keys
            },
            printQRInTerminal: true,
            syncFullHistory: false,
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log('Connection status:', connection);
            
            if (connection === 'open') {
                console.log('✅ Connected to WhatsApp!');
                console.log('User ID:', sock.user?.id);
                
                // Test sending a message
                await sock.sendMessage(sock.user.id, {
                    text: '✅ Test successful! DTZ NOVA XMD pairing system is working.'
                });
                
                console.log('✅ Test message sent');
                
                // Close connection
                setTimeout(() => {
                    sock.ws.close();
                    console.log('Connection closed');
                    process.exit(0);
                }, 3000);
            }
            
            if (connection === 'close') {
                console.log('Connection closed');
                process.exit(1);
            }
            
            if (qr) {
                console.log('QR code generated');
            }
        });
        
        // Try to get pairing code
        if (!sock.authState.creds.registered) {
            await delay(1000);
            
            try {
                const testNumber = '94700000000'; // Test number
                const pairingCode = await sock.requestPairingCode(testNumber);
                console.log('✅ Pairing code test successful!');
                console.log('Pairing code would be:', pairingCode);
            } catch (pairError) {
                console.log('⚠️ Pairing code test:', pairError.message);
                console.log('This is normal if number is invalid');
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run test
testPairing();
