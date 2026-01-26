/**
 * Content Script
 * Only injects the fingerprint spoofer if license is valid
 */

// We cannot directly check license here since content scripts run in MAIN world
// The blocking rules (enabled/disabled by background.js) handle the protection
// This script just injects the fingerprint spoofer for additional protection

// The spoofer is injected regardless, but the critical blocking of client.min.js
// is handled by declarativeNetRequest rules which are toggled by background.js

const script = document.createElement('script');
script.src = chrome.runtime.getURL('fg_sp.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

console.log('[Bypass] Fingerprint Spoofer Injected.');
