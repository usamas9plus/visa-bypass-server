/**
 * DevTools Blocker - Security Module
 * Prevents DevTools from being opened and signals Python if detection occurs
 */

(function () {
    'use strict';

    // ============================================
    // Configuration
    // ============================================
    const SIGNAL_FILE_NAME = 'devtools_detected.signal';
    const CHECK_INTERVAL = 1000; // Check every 1 second
    let devToolsOpen = false;
    let signalSent = false;

    // ============================================
    // 1. Block DevTools Keyboard Shortcuts
    // ============================================
    document.addEventListener('keydown', function (e) {
        // F12
        if (e.key === 'F12' || e.keyCode === 123) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[Security] F12 blocked');
            return false;
        }

        // Ctrl+Shift+I (Inspect)
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[Security] Ctrl+Shift+I blocked');
            return false;
        }

        // Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[Security] Ctrl+Shift+J blocked');
            return false;
        }

        // Ctrl+Shift+C (Element Inspector)
        if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[Security] Ctrl+Shift+C blocked');
            return false;
        }

        // Ctrl+U (View Source)
        if (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
            e.preventDefault();
            e.stopPropagation();
            console.warn('[Security] Ctrl+U blocked');
            return false;
        }
    }, true);

    // ============================================
    // 2. Disable Right-Click Context Menu
    // ============================================
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        console.warn('[Security] Right-click blocked');
        return false;
    }, true);

    // ============================================
    // 3. DevTools Detection Methods
    // ============================================

    // Method 1: Console timing detection
    function detectViaConsole() {
        const startTime = performance.now();
        console.log('%c', 'font-size:0;padding:100px 100px 100px 100px;');
        console.clear();
        const endTime = performance.now();

        // If console is open, this takes significantly longer
        if (endTime - startTime > 100) {
            return true;
        }
        return false;
    }

    // Method 2: Debugger detection
    function detectViaDebugger() {
        let detected = false;
        const startTime = performance.now();

        // This line pauses execution if DevTools is open with breakpoints
        debugger;

        const endTime = performance.now();

        // If execution took too long, debugger was likely hit
        if (endTime - startTime > 100) {
            detected = true;
        }
        return detected;
    }

    // Method 3: Window size detection (DevTools changes dimensions)
    let lastWidth = window.outerWidth;
    let lastHeight = window.outerHeight;

    function detectViaResize() {
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;

        // Significant difference indicates DevTools panel
        // Normal threshold for browser UI is around 50-100px
        const threshold = 200;

        if (widthDiff > threshold || heightDiff > threshold) {
            return true;
        }
        return false;
    }

    // Method 4: toString detection (devtools calls toString on functions)
    function detectViaToString() {
        let detected = false;
        const element = new Image();
        Object.defineProperty(element, 'id', {
            get: function () {
                detected = true;
                return 'detection-image';
            }
        });
        console.log(element);
        console.clear();
        return detected;
    }

    // ============================================
    // 4. Signal Handler - Notify Python
    // ============================================
    function sendSignalToPython() {
        if (signalSent) return; // Only send once

        console.error('[SECURITY ALERT] DevTools detected! Initiating cleanup...');
        signalSent = true;

        // Method 1: Use localStorage as signal (Python can monitor this file)
        try {
            localStorage.setItem('VECNA_DEVTOOLS_DETECTED', Date.now().toString());
        } catch (e) { }

        // Method 2: Create a visible signal through page behavior
        // The Python app's SecurityGuardian can detect this
        try {
            // Write to sessionStorage as backup
            sessionStorage.setItem('VECNA_SECURITY_BREACH', 'DEVTOOLS_OPENED');
        } catch (e) { }

        // Method 3: Trigger a fetch to localhost (Python can run local server)
        try {
            // Send signal to local Python app (if running local server)
            fetch('http://127.0.0.1:31337/devtools-detected', {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    timestamp: Date.now(),
                    domain: window.location.hostname,
                    signal: 'DEVTOOLS_BREACH'
                })
            }).catch(() => { });
        } catch (e) { }

        // Method 4: Aggressive page disruption
        document.body.innerHTML = '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#000;color:#f00;display:flex;align-items:center;justify-content:center;font-size:24px;z-index:999999;">SECURITY VIOLATION DETECTED</div>';

        // Method 5: Close/redirect page
        setTimeout(() => {
            window.location.href = 'about:blank';
        }, 1000);
    }

    // ============================================
    // 5. Main Detection Loop
    // ============================================
    function runDetection() {
        if (signalSent) return;

        // Run all detection methods
        const detected = detectViaResize(); // Least invasive, most reliable

        if (detected && !devToolsOpen) {
            devToolsOpen = true;
            sendSignalToPython();
        }
    }

    // Run detection periodically
    setInterval(runDetection, CHECK_INTERVAL);

    // Also run on resize events
    window.addEventListener('resize', function () {
        setTimeout(runDetection, 100);
    });

    // ============================================
    // 6. Anti-Debugging Measures
    // ============================================

    // Override console methods to prevent analysis
    const noop = function () { };
    const methods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'trace'];

    // Don't completely disable - just reduce information leakage
    // methods.forEach(m => { console[m] = noop; });

    // Detect if someone is trying to read our code
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function () {
        // If someone is inspecting our security functions, alert
        if (this.name && this.name.includes('detect')) {
            sendSignalToPython();
        }
        return originalToString.call(this);
    };

    console.log('[Security] DevTools blocker active');
})();
