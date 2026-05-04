const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'Missing key' });
        }

        // Set the requestScreenshot flag in Redis
        await redis.hset(`key:${key}`, {
            requestScreenshot: 'true'
        });

        console.log(`[SCREENSHOT REQUEST] Flag set for key: ${key}`);
        return res.status(200).json({ success: true, message: 'Screenshot requested successfully' });

    } catch (error) {
        console.error('Screenshot request error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
