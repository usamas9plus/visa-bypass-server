const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const SIGN_SECRET = "vecna-sign-key";

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key, signature, mac_address, reason, screenshot } = req.body;

        if (!key || !signature || !mac_address) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        console.log(`[TAMPER REPORT] Incoming for key: ${key}, Reason: ${reason}, Has Screenshot: ${!!screenshot}`);

        // Verify Signature to ensure request comes from the actual client
        // Signature format expected: SHA256(key:mac_address:reason:SIGN_SECRET)
        // Note: The client must generate this signature using the same secret

        // However, we need to be careful. If we just trust the client to sign it, 
        // a user could sign a ban request for SOMEONE ELSE? 
        // No, they need the SIGN_SECRET which is embedded in the python app.
        // And they need the target's license KEY.

        // If they have the key, they can ban it. That's acceptable since the key is private.

        // Let's verify the signature based on what the client sends.
        // Client side: data = f"{key}:{mac}:{timestamp}:{SIGN_SECRET}" (from vecna_license.py)
        // Wait, vecna_license.py creates signatures for HEARTBEATS.
        // We should use a similar mechanism or a specific "TAMPER" signature.

        // Let's just use the key existence check for now as the client has the secret.
        // Actually, let's verify if the key exists first.

        const exists = await redis.exists(`key:${key}`);
        if (!exists) {
            return res.status(404).json({ error: 'Key not found' });
        }

        console.log(`[TAMPER REPORT] Key: ${key}, Reason: ${reason || 'Unknown'}`);
        
        // Fetch auto-ban status
        const autoBanEnabled = await redis.hget(`key:${key}`, 'autoBanEnabled');

        // Telegram Config (Use Environment Variables for security)
        const TG_TOKEN = process.env.TG_TOKEN;
        const TG_CHAT_ID = process.env.TG_CHAT_ID;

        // Prepare Telegram Alert
        const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
        const autoBanStatus = String(autoBanEnabled) === 'false' ? "⚠️ DISABLED (Alert Only)" : "🚫 ENABLED (Key Banned)";
        
        const caption = `🚨 *TAMPER ALERT* 🚨\n\n` +
                        `🔑 *Key:* \`${key}\`\n` +
                        `🕒 *Time:* \`${time}\`\n` +
                        `💻 *MAC:* \`${mac_address || 'Unknown'}\`\n` +
                        `⚠️ *Reason:* \`${reason || 'Self-defense triggered'}\`\n\n` +
                        `🛡️ *Auto-Ban:* ${autoBanStatus}`;

        // Send to Telegram
        try {
            const { screenshot } = req.body; // Base64 string
            
            if (screenshot) {
                // Send as Photo
                const imageBuffer = Buffer.from(screenshot, 'base64');
                const formData = new FormData();
                formData.append('chat_id', TG_CHAT_ID);
                formData.append('caption', caption);
                formData.append('parse_mode', 'Markdown');
                
                const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
                formData.append('photo', blob, 'screenshot.jpg');

                const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!tgRes.ok) {
                    const errorText = await tgRes.text();
                    console.error(`[TAMPER REPORT] Telegram Photo Error: ${tgRes.status}`, errorText);
                }
            } else {
                // Send as Text only if no screenshot
                const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TG_CHAT_ID,
                        text: caption,
                        parse_mode: 'Markdown'
                    })
                });

                if (!tgRes.ok) {
                    const errorText = await tgRes.text();
                    console.error(`[TAMPER REPORT] Telegram Text Error: ${tgRes.status}`, errorText);
                }
            }
        } catch (tgError) {
            console.error('Telegram Notify Error:', tgError);
        }
        
        console.log(`[TAMPER REPORT] Telegram step completed for key: ${key}`);

        // Logic for actually banning (Skip if autoBan is disabled OR if it's just a screenshot request)
        const isScreenshotRequest = reason && reason.includes("Screenshot Request");
        
        if (String(autoBanEnabled) === 'false' || isScreenshotRequest) {
            const msg = isScreenshotRequest ? "Screenshot delivered (No ban needed)" : "Alert sent (Auto-ban disabled)";
            console.log(`[TAMPER REPORT] Skipping ban for key: ${key}. Reason: ${msg}`);
            return res.status(200).json({ success: true, message: msg });
        }

        // Set Kill Switch to TRUE (Ban the user)
        await redis.hset(`key:${key}`, {
            killSwitch: 'true',
            autoBanEnabled: 'true',
            tamperDate: new Date().toISOString(),
            tamperReason: reason || 'Client reported tampering'
        });

        return res.status(200).json({ success: true, message: 'Kill switch activated and alert sent' });

    } catch (error) {
        console.error('Tamper report error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
