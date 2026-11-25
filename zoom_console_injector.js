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
    var reactionCount = 0;
    var lastTileReactions = {};
    var recentLauncherReactionAt = 0;

    // State Tracking
    var lastState = {
        meetingTitle: null,
        muted: null,
        videoOff: null,
        handRaised: null,
        activeSpeaker: null,
        participantsCount: null,
        participantsJson: null,
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
        if (lastState.meetingTitle !== null) snapshot.meetingTitle = lastState.meetingTitle;
        if (lastState.muted !== null) snapshot.muted = lastState.muted;
        if (lastState.videoOff !== null) snapshot.videoOff = lastState.videoOff;
        if (lastState.handRaised !== null) snapshot.handRaised = lastState.handRaised;
        if (lastState.activeSpeaker !== null) snapshot.activeSpeaker = lastState.activeSpeaker;
        if (lastState.participantsCount !== null) snapshot.participantsCount = lastState.participantsCount;
        if (lastState.participantsJson !== null) {
            try { snapshot.participants = JSON.parse(lastState.participantsJson); } catch (e) {}
        }
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

        ws.onmessage = function(evt) {
            try {
                var cmd = JSON.parse(evt.data);
                if (cmd && cmd.action) {
                    handleCommand(cmd);
                }
            } catch (e) {
                console.warn("[Zoom Sync] Failed to parse command from Chataigne:", evt.data, e);
            }
        };
    }

    // Handle bidirectional commands sent from Chataigne
    function handleCommand(cmd) {
        var doc = getZoomDocument();

        if (cmd.action === 'setMute') {
            var micBtn = doc.querySelector('button.join-audio-container__btn, button[aria-label*="microphone"], button[aria-label*="Mute"], button[aria-label*="Unmute"]');
            if (micBtn) {
                var isCurrentlyMuted = (micBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('unmute') !== -1;
                if (isCurrentlyMuted !== !!cmd.value) {
                    micBtn.click();
                }
            }
        } else if (cmd.action === 'setVideo') {
            var videoBtn = doc.querySelector('button.send-video-container__btn, button[aria-label*="video"], button[aria-label*="Video"]');
            if (videoBtn) {
                var isCurrentlyOff = (videoBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('start') !== -1;
                if (isCurrentlyOff !== !!cmd.value) {
                    videoBtn.click();
                }
            }
        } else if (cmd.action === 'setHandRaised') {
            var handBtn = doc.querySelector('button.nonverbal-feedback, button[aria-label*="Raise hand"], button[aria-label*="Lower hand"]');
            if (handBtn) {
                var isCurrentlyRaised = (handBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('lower') !== -1;
                if (isCurrentlyRaised !== !!cmd.value) {
                    handBtn.click();
                }
            } else {
                triggerPickerOption(doc, 'Raise Hand');
            }
        } else if (cmd.action === 'sendReaction' && cmd.reaction) {
            triggerPickerOption(doc, cmd.reaction);
        } else if (cmd.action === 'sendChatMessage' && cmd.message) {
            sendZoomChatMessage(doc, cmd.message);
        }
    }

    function triggerPickerOption(doc, label) {
        var findOption = function() {
            var btns = doc.querySelectorAll('button.reaction-simple-picker__block');
            for (var i = 0; i < btns.length; i++) {
                var aria = (btns[i].getAttribute('aria-label') || '').trim();
                var txt = (btns[i].textContent || '').trim();
                if (aria.toLowerCase() === label.toLowerCase() || txt.toLowerCase() === label.toLowerCase()) {
                    return btns[i];
                }
            }
            return null;
        };

        var existing = findOption();
        if (existing) {
            existing.click();
            return;
        }

        var reactToggle = doc.querySelector('button[aria-label="React"]');
        if (reactToggle) {
            reactToggle.click();
            setTimeout(function() {
                var btn = findOption();
                if (btn) btn.click();
                else console.warn("[Zoom Sync] Reaction option not found:", label);
            }, 150);
        }
    }

    function sendZoomChatMessage(doc, message) {
        var trySend = function() {
            var editor = doc.querySelector('.tiptap.ProseMirror[contenteditable="true"], .tiptap.ProseMirror');
            if (!editor) return false;

            editor.focus();
            try {
                doc.execCommand('selectAll', false, null);
                doc.execCommand('insertText', false, message);
            } catch (e) {
                editor.textContent = message;
                editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: message, inputType: 'insertText' }));
            }

            setTimeout(function() {
                editor.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                }));
            }, 50);
            return true;
        };

        if (trySend()) return;

        var chatToggle = doc.querySelector('button[aria-label*="open the chat panel"]');
        if (chatToggle) {
            chatToggle.click();
            setTimeout(function() {
                if (!trySend()) {
                    console.warn("[Zoom Sync] Chat editor (.tiptap.ProseMirror) not found.");
                }
            }, 300);
        }
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

    // Convert Zoom animation-reactions/<hex> class into an emoji character
    function codeToEmoji(code) {
        try {
            var parts = code.split('-').map(function(hex) {
                return parseInt(hex, 16);
            }).filter(function(n) { return !isNaN(n); });
            return parts.length ? String.fromCodePoint.apply(null, parts) : '';
        } catch (e) {
            return '';
        }
    }

    // Scrape Per-Participant Audio, Video, Hand Raised, and Reaction Status from Gallery Video Tiles
    function scrapeParticipants(doc) {
        var tiles = doc.querySelectorAll('.gallery-video-container__video-frame');
        if (!tiles || tiles.length === 0) return null;

        var participants = {};
        for (var i = 0; i < tiles.length; i++) {
            var tile = tiles[i];
            var nameEl = tile.querySelector('.video-avatar__avatar-footer, .video-avatar__avatar-name');
            if (!nameEl) continue;
            var name = nameEl.textContent.trim();
            if (!name) continue;

            var isMuted = !!tile.querySelector('.video-avatar__avatar-footer--view-mute-computer');
            var hasVideoEl = !!tile.querySelector('video, canvas');
            var hasAvatar = !!tile.querySelector('.video-avatar__avatar');
            var isVideoOff = hasAvatar && !hasVideoEl;
            var isHandRaised = !!tile.querySelector('[class*="lazy-icon-nvf/270b"]');

            var tileReactionCode = '';
            var tileReactionEmoji = '';
            var animEl = tile.querySelector('.reaction-pop-up-container [class*="animation-reactions/"]');
            if (animEl) {
                var cls = animEl.getAttribute('class') || '';
                var match = cls.match(/animation-reactions\/([0-9a-fA-F-]+)/);
                if (match) {
                    tileReactionCode = match[1].toLowerCase();
                    tileReactionEmoji = codeToEmoji(tileReactionCode);
                }
            }

            if (tileReactionCode && lastTileReactions[name] !== tileReactionCode) {
                var now = Date.now();
                if (now - recentLauncherReactionAt > 1500) {
                    reactionCount += 1;
                    sendToChataigne({
                        event: 'reaction',
                        lastReactionSender: name,
                        lastReactionEmoji: tileReactionEmoji,
                        lastReactionCode: tileReactionCode,
                        reactionCount: reactionCount
                    });
                }
            }
            lastTileReactions[name] = tileReactionCode;

            participants[name] = {
                muted: isMuted,
                videoOff: isVideoOff,
                handRaised: isHandRaised,
                reaction: tileReactionEmoji,
                reactionCode: tileReactionCode
            };
        }
        return Object.keys(participants).length > 0 ? participants : null;
    }

    // Scrape Meeting State
    function checkMeetingState() {
        var doc = getZoomDocument();
        var state = {};

        // 0. Meeting Title
        var titleEl = doc.getElementById('meeting-info-indication');
        if (titleEl) {
            var title = titleEl.textContent.trim();
            if (title) state.meetingTitle = title;
        }

        // 1. Microphone Mute Status
        var micBtn = doc.querySelector('button.join-audio-container__btn, button[aria-label*="microphone"], button[aria-label*="mic"], button[aria-label*="Mute"], button[aria-label*="Unmute"]');
        if (micBtn) {
            var micLabel = micBtn.getAttribute('aria-label') || '';
            state.muted = micLabel.toLowerCase().indexOf('unmute') !== -1;
        } else {
            state.muted = null;
        }

        // 2. Video Camera Status
        var videoBtn = doc.querySelector('button.send-video-container__btn, button[aria-label*="video"], button[aria-label*="camera"], button[aria-label*="Video"]');
        if (videoBtn) {
            var videoLabel = videoBtn.getAttribute('aria-label') || '';
            state.videoOff = videoLabel.toLowerCase().indexOf('start') !== -1;
        } else {
            state.videoOff = null;
        }

        // 3. Local Hand Raised Status
        var handBtn = doc.querySelector('button.nonverbal-feedback, button[aria-label*="Raise hand"], button[aria-label*="Lower hand"]');
        if (handBtn) {
            var handLabel = (handBtn.getAttribute('aria-label') || '').toLowerCase();
            state.handRaised = handLabel.indexOf('lower') !== -1;
        } else {
            state.handRaised = null;
        }

        // 4. Participants Count (note: Zoom uses "particpants" typo in aria-label)
        var partEl = doc.querySelector('#participant > div > button > div > span > span') ||
                     doc.querySelector('#participant > div > button > div > span');
        if (partEl) {
            var num = parseInt(partEl.textContent.trim(), 10);
            if (!isNaN(num)) {
                state.participantsCount = num;
            }
        } else {
            var partBtn = doc.querySelector('button[aria-label*="particpants"], button[aria-label*="participants"], button[aria-label*="Participants"]');
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

        // 5. Active Speaker
        var activeSpeakerEl = doc.querySelector('.active-speaker, [class*="active-speaker"], [class*="speaker-active"]');
        if (activeSpeakerEl) {
            state.activeSpeaker = activeSpeakerEl.textContent.trim();
        } else {
            var speakerThumbnail = doc.querySelector('.speaker-highlight, [class*="speaker-highlight"], [style*="border-color: rgb(45, 140, 255)"]');
            if (speakerThumbnail) {
                state.activeSpeaker = speakerThumbnail.textContent.trim();
            }
        }

        // Detect and dispatch state changes
        var changes = { event: 'stateUpdate' };
        var hasChanges = false;

        ['meetingTitle', 'muted', 'videoOff', 'handRaised', 'activeSpeaker', 'participantsCount'].forEach(function(key) {
            if (state[key] !== lastState[key] && state[key] !== undefined && state[key] !== null) {
                lastState[key] = state[key];
                changes[key] = state[key];
                hasChanges = true;
            }
        });

        // 6. Per-Participant Audio/Video Status
        var participants = scrapeParticipants(doc);
        if (participants) {
            var participantsJson = JSON.stringify(participants);
            if (participantsJson !== lastState.participantsJson) {
                lastState.participantsJson = participantsJson;
                changes.participants = participants;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            sendToChataigne(changes);
        }

        // Keep checking if observers need setup or cleanup
        checkChatObserver();
        checkReactionObserver();
    }

    // 7. Chat Messages Observer
    var observedChatContainer = null;
    var chatObserver = null;

    function checkChatObserver() {
        var doc = getZoomDocument();
        var chatContainer = doc.querySelector('.chat-list, [class*="chat-list"], [class*="chat-messages"]');

        if (chatContainer && chatContainer !== observedChatContainer) {
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
                            if (node.nodeType === 1) {
                                var senderEl = node.querySelector('.chat-message-item__sender, [class*="sender"], [class*="name"]');
                                var textEl = node.querySelector('.chat-message-item__text, [class*="text"], [class*="message"]');

                                if (textEl) {
                                    var sender = senderEl ? senderEl.textContent.trim() : 'System';
                                    var text = textEl.textContent.trim();

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
            observedChatContainer = null;
            if (chatObserver) {
                try { chatObserver.disconnect(); } catch (e) {}
                chatObserver = null;
            }
            console.log("[Zoom Sync] Chat container removed. Stopped observing.");
        }
    }

    // 8. Reactions Observer (user & participant floating emoji reactions)
    var observedReactionRoot = null;
    var reactionObserver = null;

    function handleReactionNode(node) {
        if (!node || node.nodeType !== 1) return;

        var bullets = [];
        if (node.classList && node.classList.contains('meeting-reaction-emoji-launcher__bullet')) {
            bullets.push(node);
        } else if (node.querySelectorAll) {
            var found = node.querySelectorAll('.meeting-reaction-emoji-launcher__bullet');
            for (var i = 0; i < found.length; i++) bullets.push(found[i]);
        }

        bullets.forEach(function(bullet) {
            var nameEl = bullet.querySelector('.meeting-reaction-emoji__name-tag');
            var sender = nameEl ? nameEl.textContent.trim() : 'Unknown';
            var animEl = bullet.querySelector('[class*="animation-reactions/"]');
            var code = '';
            if (animEl && typeof animEl.className === 'string') {
                var match = animEl.className.match(/animation-reactions\/([0-9a-fA-F-]+)/);
                if (match) code = match[1].toLowerCase();
            }
            var emoji = code ? codeToEmoji(code) : '';
            if (code || emoji) {
                recentLauncherReactionAt = Date.now();
                reactionCount += 1;
                sendToChataigne({
                    event: 'reaction',
                    lastReactionSender: sender,
                    lastReactionEmoji: emoji,
                    lastReactionCode: code,
                    reactionCount: reactionCount
                });
            }
        });
    }

    function checkReactionObserver() {
        var doc = getZoomDocument();
        var reactionRoot = doc.querySelector('.reaction-animation-explosion-container, .meeting-reaction-emoji-launcher') || doc.body;

        if (reactionRoot && reactionRoot !== observedReactionRoot) {
            if (reactionObserver) {
                try { reactionObserver.disconnect(); } catch (e) {}
            }
            observedReactionRoot = reactionRoot;

            reactionObserver = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                        for (var i = 0; i < mutation.addedNodes.length; i++) {
                            handleReactionNode(mutation.addedNodes[i]);
                        }
                    }
                });
            });
            reactionObserver.observe(reactionRoot, { childList: true, subtree: true });
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
        if (reactionObserver) {
            try { reactionObserver.disconnect(); } catch (e) {}
            reactionObserver = null;
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
