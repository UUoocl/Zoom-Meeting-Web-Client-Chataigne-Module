(function() {
    console.log("%c[Zoom Sync Injector] Script loaded. Initializing WebSocket...", "color: #2D8CFF; font-weight: bold; font-size: 14px;");

    // Chataigne WebSocket Server Configuration
    var wsUrl = 'ws://127.0.0.1:8080';
    var reconnectDelayMs = 2000;

    // Clean up any previous injector instance before starting
    if (window.zoomSyncCleanup) {
        try { window.zoomSyncCleanup(); } catch (e) {}
    }

    var ws = null;
    var reconnectTimer = null;
    var isCleanedUp = false;

    // State Tracking
    var lastState = {
        muted: null,
        videoOff: null,
        activeSpeaker: null,
        participantsCount: null,
        lastChatSender: null,
        lastChatMessage: null
    };

    // Helper to send flat JSON payloads to Chataigne WebSocket Server (Protocol: JSON)
    function sendToChataigne(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            ws.send(JSON.stringify(payload));
            return true;
        } catch (e) {
            console.error("[Zoom Sync] Failed to send WebSocket message:", e);
            return false;
        }
    }

    // Send full current state on (re)connect so Chataigne values are immediately up to date
    function sendFullState() {
        var snapshot = {
            event: 'connectionStatus',
            connectionStatus: 'connected',
            error: ''
        };
        if (lastState.muted !== null) snapshot.muted = lastState.muted;
        if (lastState.videoOff !== null) snapshot.videoOff = lastState.videoOff;
        if (lastState.activeSpeaker !== null) snapshot.activeSpeaker = lastState.activeSpeaker;
        if (lastState.participantsCount !== null) snapshot.participantsCount = lastState.participantsCount;
        sendToChataigne(snapshot);
    }

    function connectWebSocket() {
        if (isCleanedUp) return;

        try {
            ws = new WebSocket(wsUrl);
        } catch (e) {
            console.error("[Zoom Sync] WebSocket creation failed (check CSP / URL):", e);
            scheduleReconnect();
            return;
        }

        ws.onopen = function() {
            console.log("%c[Zoom Sync] Connected to Chataigne at " + wsUrl, "color: #2ECC71; font-weight: bold;");
            sendFullState();
            checkMeetingState();
        };

        ws.onclose = function() {
            if (!isCleanedUp) {
                console.warn("[Zoom Sync] WebSocket closed. Reconnecting in " + (reconnectDelayMs / 1000) + "s...");
                scheduleReconnect();
            }
        };

        ws.onerror = function(err) {
            console.error("[Zoom Sync] WebSocket error:", err);
        };
    }

    function scheduleReconnect() {
        if (isCleanedUp || reconnectTimer) return;
        reconnectTimer = setTimeout(function() {
            reconnectTimer = null;
            connectWebSocket();
        }, reconnectDelayMs);
    }

    // Helper to resolve the correct document (parent page or Zoom web client iframe)
    function getZoomDocument() {
        var iframe = document.getElementById('webclient') || document.querySelector('.pwa-webclient__iframe');
        if (iframe) {
            try {
                return iframe.contentDocument || iframe.contentWindow.document;
            } catch (e) {
                // Cross-origin fallback if browser security blocks it
            }
        }
        return document;
    }

    // Scrape Meeting State
    function checkMeetingState() {
        var doc = getZoomDocument();
        var state = {};

        // 1. Microphone Mute Status
        var micBtn = doc.querySelector('button[aria-label*="microphone"], button[aria-label*="mic"], button[aria-label*="Mute"], button[aria-label*="Unmute"]');
        if (micBtn) {
            var micLabel = micBtn.getAttribute('aria-label') || '';
            state.muted = micLabel.toLowerCase().indexOf('unmute') !== -1;
        } else {
            state.muted = null;
        }

        // 2. Video Camera Status
        var videoBtn = doc.querySelector('button[aria-label*="video"], button[aria-label*="camera"], button[aria-label*="Video"]');
        if (videoBtn) {
            var videoLabel = videoBtn.getAttribute('aria-label') || '';
            state.videoOff = videoLabel.toLowerCase().indexOf('start') !== -1;
        } else {
            state.videoOff = null;
        }

        // 3. Participants Count
        var partEl = doc.querySelector('#participant > div > button > div > span > span') ||
                     doc.querySelector('#participant > div > button > div > span');
        if (partEl) {
            var num = parseInt(partEl.textContent.trim(), 10);
            if (!isNaN(num)) {
                state.participantsCount = num;
            }
        } else {
            // Fallback to general participants button
            var partBtn = doc.querySelector('button[aria-label*="participants"], button[aria-label*="Participants"]');
            if (partBtn) {
                var partLabel = partBtn.getAttribute('aria-label') || '';
                var countMatch = partLabel.match(/\d+/);
                if (countMatch) {
                    state.participantsCount = parseInt(countMatch[0], 10);
                } else {
                    var badge = partBtn.querySelector('.badge, .number, span');
                    if (badge) {
                        var badgeNum = parseInt(badge.textContent.trim(), 10);
                        if (!isNaN(badgeNum)) state.participantsCount = badgeNum;
                    }
                }
            }
        }

        // 4. Active Speaker
        var activeSpeakerEl = doc.querySelector('.active-speaker, [class*="active-speaker"], [class*="speaker-active"]');
        if (activeSpeakerEl) {
            state.activeSpeaker = activeSpeakerEl.textContent.trim();
        } else {
            // Fallback: search for active thumbnail overlay or blue/green border
            var speakerThumbnail = doc.querySelector('.speaker-highlight, [class*="speaker-highlight"], [style*="border-color: rgb(45, 140, 255)"]');
            if (speakerThumbnail) {
                state.activeSpeaker = speakerThumbnail.textContent.trim();
            }
        }

        // Detect and dispatch changes
        var changes = { event: 'stateUpdate' };
        var hasChanges = false;

        ['muted', 'videoOff', 'activeSpeaker', 'participantsCount'].forEach(function(key) {
            if (state[key] !== lastState[key] && state[key] !== undefined && state[key] !== null) {
                lastState[key] = state[key];
                changes[key] = state[key];
                hasChanges = true;
            }
        });

        if (hasChanges) {
            sendToChataigne(changes);
        }

        // Keep checking if the chat observer needs setup or cleanup
        checkChatObserver();
    }

    // 5. Chat Messages Observer
    // Dynamically manages the MutationObserver on the chat panel container
    var observedChatContainer = null;
    var chatObserver = null;

    function checkChatObserver() {
        var doc = getZoomDocument();
        var chatContainer = doc.querySelector('.chat-list, [class*="chat-list"], [class*="chat-messages"]');

        if (chatContainer && chatContainer !== observedChatContainer) {
            // Clean up previous observer if any
            if (chatObserver) {
                try { chatObserver.disconnect(); } catch (e) {}
            }
            observedChatContainer = chatContainer;
            console.log("[Zoom Sync] Chat container found. Observing chat messages...");

            chatObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                        for (var i = 0; i < mutation.addedNodes.length; i++) {
                            var node = mutation.addedNodes[i];
                            if (node.nodeType === 1) { // Element node
                                var senderEl = node.querySelector('.chat-message-item__sender, [class*="sender"], [class*="name"]');
                                var textEl = node.querySelector('.chat-message-item__text, [class*="text"], [class*="message"]');

                                if (textEl) {
                                    var sender = senderEl ? senderEl.textContent.trim() : 'System';
                                    var text = textEl.textContent.trim();

                                    // Prevent double-triggering of identical messages
                                    if (lastState.lastChatMessage !== text || lastState.lastChatSender !== sender) {
                                        lastState.lastChatMessage = text;
                                        lastState.lastChatSender = sender;

                                        sendToChataigne({
                                            event: 'chatMessage',
                                            lastChatSender: sender,
                                            lastChatMessage: text
                                        });
                                    }
                                }
                            }
                        }
                    }
                });
            });
            chatObserver.observe(chatContainer, { childList: true, subtree: true });
        } else if (!chatContainer && observedChatContainer) {
            // Chat container disappeared (chat panel closed)
            observedChatContainer = null;
            if (chatObserver) {
                try { chatObserver.disconnect(); } catch (e) {}
                chatObserver = null;
            }
            console.log("[Zoom Sync] Chat container removed. Stopped observing.");
        }
    }

    // Connect WebSocket and set up periodic check for state updates
    connectWebSocket();
    var stateCheckInterval = setInterval(checkMeetingState, 1000);
    checkMeetingState();

    window.zoomSyncCleanup = function() {
        isCleanedUp = true;
        clearInterval(stateCheckInterval);
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        if (chatObserver) {
            try { chatObserver.disconnect(); } catch (e) {}
            chatObserver = null;
        }
        if (ws) {
            try {
                sendToChataigne({ event: 'connectionStatus', connectionStatus: 'disconnected' });
                ws.close();
            } catch (e) {}
            ws = null;
        }
        console.log("[Zoom Sync] Cleaned up previous observer instance.");
    };
})();
