/**
 * Fingerprint Spoofing Script (Advanced)
 * 1. Hides Webdriver.
 * 2. Adds subtle noise.
 * 3. INTERCEPTS cookie/storage setting to randomize visitorId if the site tries to set it.
 */

(function () {
    'use strict';

    // Seed setup
    let seedVal = parseInt(sessionStorage.getItem('__fp_seed__'));
    if (!seedVal || isNaN(seedVal)) {
        seedVal = Math.floor(Math.random() * 10000000);
        sessionStorage.setItem('__fp_seed__', seedVal);
    }
    const SEED = seedVal;

    function mulberry32(a) {
        return function () {
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
    }
    const random = mulberry32(SEED);

    console.log(`[Bypass] Blocking & Spoofing Active. Seed: ${SEED}`);

    try {
        // 1. Hide Webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // 2. Cookie Interception (Prevent same visitorId)
        // If the site tries to save "visitorId_current", we modify it? 
        // Or we just let the block rule handle the generation script.
        // But if the script is blocked, maybe the site fails?
        // Let's protect against manual setting just in case.

        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'visitorId_current' || key.includes('fingerprint')) {
                // If the site tries to persist a fingerprint, we append our seed
                // to force it to be unique for this session
                const newValue = value + '_' + SEED;
                console.log(`[Bypass] Modified storage ${key}:`, newValue);
                return originalSetItem.call(this, key, newValue);
            }
            return originalSetItem.apply(this, arguments);
        };

        // 3. Canvas Spoofing (Subtle)
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
            value: function () {
                const ctx = this.getContext('2d');
                if (ctx) {
                    const w = this.width;
                    const h = this.height;
                    const x = Math.floor(random() * (w || 0));
                    const y = Math.floor(random() * (h || 0));
                    const oldFill = ctx.fillStyle;
                    ctx.fillStyle = `rgba(${Math.floor(random() * 255)},${Math.floor(random() * 255)},${Math.floor(random() * 255)},0.01)`;
                    ctx.fillRect(x, y, 1, 1);
                    ctx.fillStyle = oldFill;
                }
                return originalToDataURL.apply(this, arguments);
            }
        });

        // 4. Audio Spoofing
        const originalCreateOscillator = AudioContext.prototype.createOscillator;
        const audioDetune = (random() * 0.0001);
        AudioContext.prototype.createOscillator = function () {
            const osc = originalCreateOscillator.apply(this, arguments);
            const originalStart = osc.start;
            osc.start = function (when = 0) {
                return originalStart.call(this, when + audioDetune);
            };
            return osc;
        };

    } catch (e) {
        console.error('[Bypass] Spoofing error', e);
    }

})();
