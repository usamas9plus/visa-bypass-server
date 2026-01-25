const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Check admin auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { key, enabled } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'Missing key' });
        }

        // Check if key exists
        const exists = await redis.exists(`key:${key}`);
        if (!exists) {
            return res.status(404).json({ error: 'Key not found' });
        }

        // Update kill switch status
        const val = enabled ? 'true' : 'false';
        await redis.hset(`key:${key}`, {
            killSwitch: val
        });

        // Verify write
        const verified = await redis.hget(`key:${key}`, 'killSwitch');

        if (String(verified) !== String(val)) {
            console.error(`Write failed! Expected ${val}, got ${verified}`);
            return res.status(500).json({
                error: `Persistence failed: Exp '${val}' Got '${verified}' (Type mismatch?)`
            });
        }

        return res.status(200).json({ success: true, killSwitch: enabled, stored: verified });

    } catch (error) {
        console.error('Toggle kill error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
