/**
 * Isolated World Injector
 * Runs in ISOLATED world where chrome.runtime APIs work
 * Injects security scripts into MAIN world via script tag
 */

// Inject DevTools Blocker (ui_polyfill.js)
(function () {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('ui_polyfill.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
})();

// Inject Fingerprint Spoofer (fg_sp.js)
(function () {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('fg_sp.js');
    script.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
})();

console.log('[Bypass] Security modules injected from isolated world.');
