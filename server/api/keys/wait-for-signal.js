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

        console.log(`[SIGNAL WAIT] Client started waiting for signal: ${key}`);

        // Long Polling Loop: Check Redis every 2 seconds for up to 45 seconds
        const startTime = Date.now();
        const timeout = 45000; // 45 seconds

        while (Date.now() - startTime < timeout) {
            const signal = await redis.hget(`key:${key}`, 'requestScreenshot');
            
            if (signal === 'true') {
                await redis.hdel(`key:${key}`, 'requestScreenshot');
                console.log(`[SIGNAL WAIT] Signal FOUND for key: ${key}. Sending to client.`);
                return res.status(200).json({ signal: 'screenshot' });
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        return res.status(200).json({ signal: 'none' });

    } catch (error) {
        console.error('Signal wait error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
