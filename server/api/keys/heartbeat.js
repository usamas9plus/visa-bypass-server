const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// Signing secret (should match Python program)
const SIGN_SECRET = 'vecna-sign-key';

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key, macAddress, timestamp, signature, offline } = req.body;

        if (!key || !macAddress) {
            return res.status(400).json({ error: 'Missing key or macAddress' });
        }

        // Verify request signature
        if (timestamp && signature) {
            const now = Date.now();
            const requestAge = now - timestamp;

            // Reject requests older than 5 minutes
            if (requestAge > 5 * 60 * 1000 || requestAge < -60000) {
                return res.status(403).json({ error: 'Request expired', code: 'EXPIRED_REQUEST' });
            }

            // Verify signature
            const expectedSignature = crypto
                .createHash('sha256')
                .update(`${key}:${macAddress}:${timestamp}:${SIGN_SECRET}`)
                .digest('hex')
                .substring(0, 32);

            if (signature !== expectedSignature) {
                return res.status(403).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' });
            }
        }

        // Lookup key in Redis
        const keyData = await redis.hgetall(`key:${key}`);

        if (!keyData || !keyData.key) {
            return res.status(404).json({ error: 'Invalid license key', code: 'KEY_NOT_FOUND' });
        }

        // Verify MAC address matches (Multi-device support)
        const deviceRestrictionDisabled = String(keyData.disableDeviceRestriction) === 'true';
        const macAddresses = keyData.macAddresses ? keyData.macAddresses.split(',') : (keyData.macAddress ? [keyData.macAddress] : []);
        
        if (!deviceRestrictionDisabled) {
            if (!macAddresses.includes(macAddress)) {
                return res.status(403).json({
                    error: 'MAC address mismatch or unauthorized device.',
                    code: 'MAC_MISMATCH'
                });
            }
        }

        // Update heartbeat timestamp (or set offline)
        if (offline) {
            // Python program was closed - mark as offline
            await redis.hset(`key:${key}`, {
                lastHeartbeat: '0',
                isOnline: 'false'
            });

            return res.status(200).json({
                success: true,
                message: 'Marked offline'
            });
        } else {
            // Regular heartbeat - mark as online
            await redis.hset(`key:${key}`, {
                lastHeartbeat: Date.now().toString(),
                isOnline: 'true'
            });

            // Check for KILL SWITCH (Only if auto-ban enforcement is enabled)
            const autoBanEnabled = String(keyData.autoBanEnabled) !== 'false';
            if (autoBanEnabled && String(keyData.killSwitch) === 'true') {
                return res.status(200).json({
                    success: true,
                    kill: true,
                    message: 'Order 66'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Heartbeat received'
            });
        }

    } catch (error) {
        console.error('Heartbeat error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
