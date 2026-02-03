const { Redis } = require('@upstash/redis');
const { generateKey } = require('../../lib/crypto');

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
        const { expiresInDays = 30, label = '' } = req.body;

        const key = generateKey();
        const now = Date.now();
        const expiresAt = now + (expiresInDays * 24 * 60 * 60 * 1000);

        // Store key in Redis
        await redis.hset(`key:${key}`, {
            key: key,
            createdAt: now.toString(),
            expiresAt: expiresAt.toString(),
            expiresInDays: expiresInDays.toString(),
            label: label,
            deviceId: '',
            activatedAt: '',
            lastUsed: '',
            revoked: 'false'
        });

        // Add to keys index
        await redis.sadd('keys:all', key);

        return res.status(200).json({
            success: true,
            key: key,
            expiresAt: expiresAt,
            expiresInDays: expiresInDays,
            label: label
        });

    } catch (error) {
        console.error('Create error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
