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
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'Missing key' });
        }

        // Check if key exists
        const keyData = await redis.hgetall(`key:${key}`);
        if (!keyData || !keyData.key) {
            return res.status(404).json({ error: 'Key not found' });
        }

        // Mark as revoked
        await redis.hset(`key:${key}`, {
            revoked: 'true',
            revokedAt: Date.now().toString()
        });

        return res.status(200).json({
            success: true,
            message: 'Key revoked successfully'
        });

    } catch (error) {
        console.error('Revoke error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
