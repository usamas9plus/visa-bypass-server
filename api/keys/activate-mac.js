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
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key, macAddress, timestamp, signature, checkOnly } = req.body;

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

        // Check if revoked
        if (keyData.revoked === 'true') {
            return res.status(403).json({ error: 'License key has been revoked', code: 'KEY_REVOKED' });
        }

        // Check KILL SWITCH
        if (keyData.killSwitch === 'true') {
            return res.status(200).json({
                valid: false,
                kill: true,
                error: 'Security violation detected',
                code: 'ORDER_66'
            });
        }

        // Check expiry
        const expiresAt = parseInt(keyData.expiresAt);
        if (expiresAt < Date.now()) {
            return res.status(403).json({ error: 'License key has expired', code: 'KEY_EXPIRED' });
        }

        // Check MAC address lock
        if (keyData.macAddress && keyData.macAddress !== macAddress) {
            return res.status(403).json({
                error: 'License is already bound to a different computer',
                code: 'MAC_MISMATCH'
            });
        }

        // If no MAC bound yet, bind this MAC (unless checkOnly)
        if (!keyData.macAddress && !checkOnly) {
            await redis.hset(`key:${key}`, {
                macAddress: macAddress,
                macActivatedAt: Date.now().toString()
            });
            keyData.macAddress = macAddress;
        }

        // Update last used
        await redis.hset(`key:${key}`, {
            lastMacCheck: Date.now().toString()
        });

        return res.status(200).json({
            valid: true,
            macBound: true,
            expiresAt: expiresAt,
            daysRemaining: Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
            label: keyData.label || null
        });

    } catch (error) {
        console.error('Activate MAC error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
