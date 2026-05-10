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
        if (!key) return res.status(400).json({ error: 'Missing key' });

        // ULTRA-LEAN MODE: Check Redis only ONCE to save usage limits
        // Since the Python app polls every ~10s, this is the only way to stay in Free Tier
        const signal = await redis.hget(`key:${key}`, 'requestScreenshot');
        
        if (String(signal) === 'true') {
            await redis.hdel(`key:${key}`, 'requestScreenshot');
            console.log(`[SIGNAL] Signal found for ${key.substring(0,8)}`);
            return res.status(200).json({ signal: 'screenshot' });
        }

        // Hold the connection for 9s to prevent the client from immediately re-polling
        // but WITHOUT doing any more Redis calls.
        await new Promise(resolve => setTimeout(resolve, 9000));


        return res.status(200).json({ signal: 'none' });

    } catch (error) {
        console.error('Signal wait error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
