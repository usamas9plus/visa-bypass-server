/**
 * Content Script (MAIN World)
 * Runs in the page context for direct DOM access
 * Note: Script injection is now handled by injector.js in ISOLATED world
 */

// The blocking rules (enabled/disabled by background.js) handle the protection
// Script injection is handled by injector.js which runs in ISOLATED world
// This file runs in MAIN world for any future page context operations

console.log('[Bypass] Content script loaded in MAIN world.');
