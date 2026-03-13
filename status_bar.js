/**
 * Vecna Bypass Status Bar
 * Professional, high-end UI to display bypass status on the webpage.
 */

(function () {
    // Prevent double injection
    if (window.vecnaStatusBarInjected) return;
    window.vecnaStatusBarInjected = true;

    const CSS = `
        #vecna-status-bar-container {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            pointer-events: none;
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #vecna-status-bar {
            background: rgba(10, 10, 10, 0.8);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 50px;
            padding: 8px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            pointer-events: auto;
            user-select: none;
            transition: all 0.5s ease;
        }

        #vecna-status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #444;
            transition: all 0.5s ease;
        }

        #vecna-status-text {
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }

        #vecna-status-label {
            color: rgba(255, 255, 255, 0.5);
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            margin-right: 2px;
        }

        /* Active State */
        #vecna-status-bar.active {
            border-color: rgba(34, 197, 94, 0.3);
            box-shadow: 0 0 20px rgba(34, 197, 94, 0.2), 0 10px 30px rgba(0, 0, 0, 0.5);
        }

        #vecna-status-bar.active #vecna-status-dot {
            background: #22c55e;
            box-shadow: 0 0 10px #22c55e, 0 0 20px rgba(34, 197, 94, 0.5);
            animation: vecna-pulse 2s infinite;
        }

        #vecna-status-bar.active #vecna-status-text {
            color: #22c55e;
            text-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
        }

        /* Inactive State */
        #vecna-status-bar.inactive {
            border-color: rgba(239, 68, 68, 0.2);
        }

        #vecna-status-bar.inactive #vecna-status-dot {
            background: #ef4444;
            box-shadow: 0 0 10px #ef4444;
        }

        #vecna-status-bar.inactive #vecna-status-text {
            color: #ef4444;
        }

        @keyframes vecna-pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.2); opacity: 0.7; }
            100% { transform: scale(1); opacity: 1; }
        }
    `;

    function init() {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.id = 'vecna-status-bar-container';
        
        const bar = document.createElement('div');
        bar.id = 'vecna-status-bar';
        
        const dot = document.createElement('div');
        dot.id = 'vecna-status-dot';
        
        const content = document.createElement('div');
        content.id = 'vecna-status-content';
        
        const label = document.createElement('span');
        label.id = 'vecna-status-label';
        label.textContent = 'Bypass Status: ';
        
        const text = document.createElement('span');
        text.id = 'vecna-status-text';
        text.textContent = 'CHECKING...';
        
        content.appendChild(label);
        content.appendChild(text);
        bar.appendChild(dot);
        bar.appendChild(content);
        container.appendChild(bar);
        
        // Use document.body if available, otherwise documentElement
        (document.body || document.documentElement).appendChild(container);

        // Initial check
        chrome.storage.local.get(['protectionActive'], (data) => {
            updateStatus(data.protectionActive);
        });

        // Listen for changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.protectionActive) {
                updateStatus(changes.protectionActive.newValue);
            }
        });
    }

    function updateStatus(active) {
        const bar = document.getElementById('vecna-status-bar');
        const text = document.getElementById('vecna-status-text');
        
        if (!bar || !text) return;

        if (active) {
            bar.className = 'active';
            text.textContent = 'ACTIVE';
        } else {
            bar.className = 'inactive';
            text.textContent = 'INACTIVE';
        }
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
