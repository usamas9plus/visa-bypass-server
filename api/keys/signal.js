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

        console.log(`[SIGNAL WAIT] Client connection: ${key}`);

        // Long Polling Loop: Check Redis every 1.5 seconds for up to 8 seconds
        // (Vercel Hobby timeout is 10s)
        const startTime = Date.now();
        const timeout = 8000; 

        while (Date.now() - startTime < timeout) {
            const signal = await redis.hget(`key:${key}`, 'requestScreenshot');
            
            if (signal === 'true') {
                // Clear the flag immediately
                await redis.hdel(`key:${key}`, 'requestScreenshot');
                console.log(`[SIGNAL WAIT] Signal FOUND for key: ${key}. Sending to client.`);
                return res.status(200).json({ signal: 'screenshot' });
            }

            // Sleep for 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Timeout - tell client to try again
        return res.status(200).json({ signal: 'none' });

    } catch (error) {
        console.error('Signal wait error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
