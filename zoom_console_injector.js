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
    var lastParticipantNames = {};
    var recentLauncherReactionAt = 0;

    // State Tracking
    var lastState = {
        meetingTitle: null,
        muted: null,
        videoOff: null,
        handRaised: null,
        isHost: null,
        waitingRoomEnabled: null,
        meetingLocked: null,
        hideProfilePictures: null,
        allowRenameSelf: null,
        allowUnmuteSelf: null,
        allowStartVideo: null,
        focusMode: null,
        screenSharing: null,
        screenSharer: null,
        localSharing: null,
        currentView: null,
        participantsPanelOpen: null,
        chatPanelOpen: null,
        chatRecipient: null,
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
        [
            'meetingTitle', 'muted', 'videoOff', 'handRaised', 'isHost',
            'waitingRoomEnabled', 'meetingLocked', 'hideProfilePictures',
            'allowRenameSelf', 'allowUnmuteSelf', 'allowStartVideo', 'focusMode',
            'screenSharing', 'screenSharer', 'localSharing', 'currentView',
            'participantsPanelOpen', 'chatPanelOpen', 'chatRecipient',
            'activeSpeaker', 'participantsCount'
        ].forEach(function(k) {
            if (lastState[k] !== null) snapshot[k] = lastState[k];
        });
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

    function isVisible(el) {
        return !!(el && el.offsetParent !== null);
    }

    // Open a dropdown/menu via triggerSel, find matching item via itemSel, and click it
    function clickMenuOption(doc, triggerSel, menuSel, itemSel, matchFn, delayMs) {
        var findInMenu = function() {
            var root = doc.querySelector(menuSel) || doc;
            var items = root.querySelectorAll(itemSel);
            for (var i = 0; i < items.length; i++) {
                if (matchFn(items[i])) return items[i];
            }
            return null;
        };

        if (doc.querySelector(menuSel)) {
            var existing = findInMenu();
            if (existing) {
                existing.click();
                return;
            }
        }

        var trigger = doc.querySelector(triggerSel);
        if (!trigger) {
            console.warn("[Zoom Sync] Menu trigger not found:", triggerSel);
            return;
        }
        trigger.click();
        setTimeout(function() {
            var target = findInMenu();
            if (target) {
                target.click();
            } else {
                console.warn("[Zoom Sync] Menu option not found in", menuSel);
                trigger.click();
            }
        }, delayMs || 180);
    }

    // Handle bidirectional commands sent from Chataigne
    function handleCommand(cmd) {
        var doc = getZoomDocument();

        if (cmd.action === 'setMute') {
            var micBtn = doc.querySelector('button.join-audio-container__btn, button[aria-label*="microphone"], button[aria-label*="Mute"], button[aria-label*="Unmute"]');
            if (micBtn) {
                var isCurrentlyMuted = (micBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('unmute') !== -1;
                if (isCurrentlyMuted !== !!cmd.value) micBtn.click();
            }
        } else if (cmd.action === 'setVideo') {
            var videoBtn = doc.querySelector('button.send-video-container__btn, button[aria-label*="video"], button[aria-label*="Video"]');
            if (videoBtn) {
                var isCurrentlyOff = (videoBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('start') !== -1;
                if (isCurrentlyOff !== !!cmd.value) videoBtn.click();
            }
        } else if (cmd.action === 'setHandRaised') {
            var handBtn = doc.querySelector('button.nonverbal-feedback, button[aria-label*="Raise hand"], button[aria-label*="Lower hand"]');
            if (handBtn) {
                var isCurrentlyRaised = (handBtn.getAttribute('aria-label') || '').toLowerCase().indexOf('lower') !== -1;
                if (isCurrentlyRaised !== !!cmd.value) handBtn.click();
            } else {
                triggerPickerOption(doc, 'Raise Hand');
            }
        } else if (cmd.action === 'sendReaction' && cmd.reaction) {
            triggerPickerOption(doc, cmd.reaction);
        } else if (cmd.action === 'sendChatMessage' && cmd.message) {
            sendZoomChatMessage(doc, cmd.message, cmd.recipient || '');
        } else if (cmd.action === 'setView' && cmd.view) {
            clickMenuOption(
                doc,
                'button.full-screen-widget__button[aria-label="View"]',
                '.full-screen-widget__pop-menu.show',
                'a.dropdown-item',
                function(el) {
                    return (el.getAttribute('aria-label') || '').toLowerCase() === cmd.view.toLowerCase();
                }
            );
        } else if (cmd.action === 'setParticipantsPanel') {
            var pOpen = isVisible(doc.querySelector('.participants-section-container'));
            if (pOpen !== !!cmd.value) {
                var pBtn = doc.querySelector('button[aria-label*="participants list pane"], button[aria-label*="particpants"]');
                if (pBtn) pBtn.click();
            }
        } else if (cmd.action === 'setChatPanel') {
            var cOpen = isVisible(doc.querySelector('.chat-container'));
            if (cOpen !== !!cmd.value) {
                var cBtn = doc.querySelector('button[aria-label*="chat panel"]');
                if (cBtn) cBtn.click();
            }
        } else if (cmd.action === 'pinParticipant' && cmd.name) {
            pinParticipantByName(doc, cmd.name);
        } else if (cmd.action === 'moreAction' && cmd.item) {
            clickMenuOption(
                doc,
                'button.more-button__dropdown-toggle[aria-label^="More meeting control"]',
                '.more-button__pop-menu.show',
                'button.more-button__item-box',
                function(el) {
                    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    var txt = (el.textContent || '').trim().toLowerCase();
                    return aria === cmd.item.toLowerCase() || txt === cmd.item.toLowerCase();
                }
            );
        } else if (cmd.action === 'screenShareAction') {
            if (cmd.mode === 'open') {
                var shareBtn = doc.querySelector('button.sharing-entry-button-container[aria-label="Share"]');
                if (shareBtn) shareBtn.click();
            } else if (cmd.mode === 'pause') {
                var pauseBtn = doc.querySelector('button.sharer-button--independent-btn[aria-label="Pause share"]');
                if (pauseBtn) pauseBtn.click();
            } else if (cmd.mode === 'stop') {
                var stopBtn = doc.querySelector('button.sharer-button--stop');
                if (stopBtn) stopBtn.click();
            }
        } else if (cmd.action === 'selectAudioDevice' && cmd.name) {
            clickMenuOption(
                doc,
                'button[aria-label="More audio controls"]',
                '.audio-option-menu.show',
                'a.audio-option-menu__device-item',
                function(el) {
                    return (el.getAttribute('aria-label') || '').toLowerCase().indexOf(cmd.name.toLowerCase()) !== -1;
                }
            );
        } else if (cmd.action === 'toggleNoiseSuppression') {
            clickMenuOption(
                doc,
                'button[aria-label="More audio controls"]',
                '.audio-option-menu.show',
                'a.dropdown-item',
                function(el) {
                    return (el.textContent || '').toLowerCase().indexOf('noise suppression') !== -1;
                }
            );
        } else if (cmd.action === 'selectVideoDevice' && cmd.name) {
            clickMenuOption(
                doc,
                'button[aria-label="More video controls"]',
                '.video-option-menu__pop-menu.show',
                'a.dropdown-item',
                function(el) {
                    return (el.getAttribute('aria-label') || '').toLowerCase().indexOf(cmd.name.toLowerCase()) !== -1;
                }
            );
        } else if (cmd.action === 'muteAll') {
            ensureParticipantsPanel(doc, function() {
                var btns = doc.querySelectorAll('button.participants-section-container__buttom-button');
                for (var i = 0; i < btns.length; i++) {
                    if ((btns[i].textContent || '').trim().toLowerCase() === 'mute all') {
                        btns[i].click();
                        return;
                    }
                }
            });
        } else if (cmd.action === 'participantsMoreAction' && cmd.item) {
            ensureParticipantsPanel(doc, function() {
                clickMenuOption(
                    doc,
                    'button[aria-label="More managing participants options"]',
                    '.participant-host-dropdown.show',
                    'a.dropdown-item',
                    function(el) {
                        return (el.textContent || '').trim().toLowerCase() === cmd.item.toLowerCase();
                    }
                );
            });
        } else if (cmd.action === 'participantHostAction' && cmd.name && cmd.item) {
            runParticipantHostAction(doc, cmd.name, cmd.item);
        } else if (cmd.action === 'setHostOption' && cmd.option) {
            setHostSwitchOption(doc, cmd.option, !!cmd.value);
        } else if (cmd.action === 'suspendParticipantActivities') {
            openHostToolsSubmenu(doc, 'Participants', function() {
                var btn = doc.querySelector('button.host-tools-panel__danger-action');
                if (btn) btn.click();
            });
        } else if (cmd.action === 'leaveOrEndMeeting' && cmd.mode) {
            var endBtn = doc.querySelector('button.footer-button__button[aria-label="End"], button.footer-button__button[aria-label="Leave"]');
            if (endBtn) {
                endBtn.click();
                setTimeout(function() {
                    var items = doc.querySelectorAll('.leave-meeting-options button[role="menuitem"]');
                    for (var i = 0; i < items.length; i++) {
                        if ((items[i].textContent || '').trim().toLowerCase() === cmd.mode.toLowerCase()) {
                            items[i].click();
                            return;
                        }
                    }
                }, 180);
            }
        }
    }

    function ensureParticipantsPanel(doc, cb) {
        if (isVisible(doc.querySelector('.participants-section-container'))) {
            cb();
            return;
        }
        var pBtn = doc.querySelector('button[aria-label*="participants list pane"], button[aria-label*="particpants"]');
        if (pBtn) {
            pBtn.click();
            setTimeout(cb, 300);
        }
    }

    function openHostToolsSubmenu(doc, submenuLabel, cb) {
        var openPanel = function() {
            if (!submenuLabel) {
                cb();
                return;
            }
            var subBtn = doc.querySelector('button.host-tools-panel__menu-button[aria-label="' + submenuLabel + '"]');
            if (subBtn) {
                subBtn.click();
                setTimeout(cb, 180);
            } else {
                cb();
            }
        };

        if (isVisible(doc.querySelector('.host-tools-panel'))) {
            var backBtn = doc.querySelector('button.panel-shell-header__back[aria-label="Back"]');
            if (backBtn) {
                backBtn.click();
                setTimeout(openPanel, 150);
            } else {
                openPanel();
            }
            return;
        }

        var hostBtn = doc.querySelector('button[aria-label="Host tools"]');
        if (!hostBtn) {
            console.warn("[Zoom Sync] Host tools button not found.");
            return;
        }
        hostBtn.click();
        setTimeout(openPanel, 220);
    }

    function setHostSwitchOption(doc, optionPrefix, enabled) {
        var submenu = '';
        if (optionPrefix.indexOf('allow participant') === 0) submenu = 'Participants';
        else if (optionPrefix === 'Focus mode') submenu = 'Advanced';

        openHostToolsSubmenu(doc, submenu, function() {
            var sw = doc.querySelector('input.prism-SwitchBase-input[role="switch"][aria-label^="' + optionPrefix + '"]');
            if (sw) {
                var current = sw.getAttribute('aria-checked') === 'true';
                if (current !== enabled) sw.click();
            } else {
                console.warn("[Zoom Sync] Host switch not found:", optionPrefix);
            }
            setTimeout(function() {
                checkMeetingState();
                var closeBtn = doc.querySelector('button.host-tools-panel__close-right[aria-label="Close"]');
                if (closeBtn) closeBtn.click();
            }, 180);
        });
    }

    function runParticipantHostAction(doc, targetName, actionLabel) {
        ensureParticipantsPanel(doc, function() {
            var rows = doc.querySelectorAll('.item-pos.participants-li');
            var needle = targetName.toLowerCase();
            for (var i = 0; i < rows.length; i++) {
                var aria = (rows[i].getAttribute('aria-label') || '').toLowerCase();
                var text = (rows[i].textContent || '').toLowerCase();
                if (aria.indexOf(needle) !== -1 || text.indexOf(needle) !== -1) {
                    var quickBtn = rows[i].querySelector('button.participants-icon__action[aria-label="' + actionLabel + '"]');
                    if (quickBtn) {
                        quickBtn.click();
                        return;
                    }
                    var moreBtn = rows[i].querySelector('button.participants-icon__action[aria-label="More options"]');
                    if (moreBtn) {
                        moreBtn.click();
                        setTimeout(function() {
                            var items = doc.querySelectorAll('.zmu-portal-dropdown__menu-list button.zmu-portal-dropdown__menu-item-button');
                            for (var j = 0; j < items.length; j++) {
                                if ((items[j].textContent || '').trim().toLowerCase() === actionLabel.toLowerCase()) {
                                    items[j].click();
                                    return;
                                }
                            }
                            console.warn("[Zoom Sync] Participant action not found:", actionLabel);
                        }, 180);
                    }
                    return;
                }
            }
        });
    }

    function pinParticipantByName(doc, targetName) {
        var clickMoreAndPin = function() {
            var rows = doc.querySelectorAll('.item-pos.participants-li');
            var needle = targetName.toLowerCase();
            for (var i = 0; i < rows.length; i++) {
                var aria = (rows[i].getAttribute('aria-label') || '').toLowerCase();
                var text = (rows[i].textContent || '').toLowerCase();
                if (aria.indexOf(needle) !== -1 || text.indexOf(needle) !== -1) {
                    var moreBtn = rows[i].querySelector('button.participants-icon__action[aria-label="More options"]');
                    if (moreBtn) {
                        moreBtn.click();
                        setTimeout(function() {
                            var items = doc.querySelectorAll('.zmu-portal-dropdown__menu-list button.zmu-portal-dropdown__menu-item-button');
                            for (var j = 0; j < items.length; j++) {
                                var txt = (items[j].textContent || '').trim().toLowerCase();
                                if (txt.indexOf('pin') !== -1) {
                                    items[j].click();
                                    return;
                                }
                            }
                        }, 180);
                    }
                    return true;
                }
            }
            return false;
        };

        if (isVisible(doc.querySelector('.participants-section-container'))) {
            clickMoreAndPin();
            return;
        }
        var pBtn = doc.querySelector('button[aria-label*="participants list pane"], button[aria-label*="particpants"]');
        if (pBtn) {
            pBtn.click();
            setTimeout(clickMoreAndPin, 300);
        }
    }

    function triggerPickerOption(doc, label) {
        clickMenuOption(
            doc,
            'button[aria-label="React"]',
            '.reaction-simple-picker__block',
            'button.reaction-simple-picker__block',
            function(el) {
                var aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                var txt = (el.textContent || '').trim().toLowerCase();
                return aria === label.toLowerCase() || txt === label.toLowerCase();
            },
            150
        );
    }

    function sendZoomChatMessage(doc, message, recipient) {
        var doTypeAndSend = function() {
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
                var sendBtn = doc.querySelector('button.chat-rtf-box__send[aria-label="send"]:not(.chat-rtf-box__send--disabled)');
                if (sendBtn) {
                    sendBtn.click();
                } else {
                    editor.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    }));
                }
            }, 60);
            return true;
        };

        var afterPanelOpen = function() {
            if (recipient) {
                clickMenuOption(
                    doc,
                    'button.chat-receiver-list__receiver',
                    '.chat-receiver-list .dropdown-menu.show',
                    'a.chat-receiver-list__menu-item',
                    function(el) {
                        return (el.textContent || '').trim().toLowerCase().indexOf(recipient.toLowerCase()) !== -1;
                    },
                    150
                );
                setTimeout(doTypeAndSend, 260);
            } else {
                doTypeAndSend();
            }
        };

        if (isVisible(doc.querySelector('.chat-container'))) {
            afterPanelOpen();
            return;
        }

        var chatToggle = doc.querySelector('button[aria-label*="open the chat panel"]');
        if (chatToggle) {
            chatToggle.click();
            setTimeout(afterPanelOpen, 300);
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

    // Scrape Per-Participant Status from Gallery Video Tiles and Participants Panel Rows
    function scrapeParticipants(doc) {
        var participants = {};

        // A. Video Tiles
        var tiles = doc.querySelectorAll('.gallery-video-container__video-frame');
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

        // B. Participants Panel Rows (enriches role & captures off-screen participants when panel is open)
        var rows = doc.querySelectorAll('.item-pos.participants-li');
        for (var j = 0; j < rows.length; j++) {
            var row = rows[j];
            var aria = row.getAttribute('aria-label') || '';
            if (!aria) continue;
            var parts = aria.split(',');
            var rawName = (parts[0] || '').trim();
            if (!rawName) continue;

            var role = '';
            var cleanName = rawName.replace(/\s*\((Host|Co-host|Me)\)\s*$/i, function(_, r) {
                role = r;
                return '';
            }).trim();
            if (!cleanName) continue;

            var lowerAria = aria.toLowerCase();
            var rowMuted = lowerAria.indexOf('audio muted') !== -1;
            var rowVideoOff = lowerAria.indexOf('video off') !== -1;

            if (!participants[cleanName]) {
                participants[cleanName] = {
                    muted: rowMuted,
                    videoOff: rowVideoOff,
                    handRaised: !!row.querySelector('[class*="lazy-icon-nvf/270b"]'),
                    reaction: '',
                    reactionCode: ''
                };
            } else {
                participants[cleanName].muted = rowMuted;
                participants[cleanName].videoOff = rowVideoOff;
            }
            if (role) participants[cleanName].role = role;
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

        // 3b. Host Role & Host Tools Switches (when Host tools panel is open)
        state.isHost = !!doc.querySelector('button[aria-label="Host tools"], button.footer-button__button[aria-label="End"]');
        if (isVisible(doc.querySelector('.host-tools-panel'))) {
            var hostSwitchMap = {
                waitingRoomEnabled: 'Enable waiting room',
                meetingLocked: 'Lock Meeting',
                hideProfilePictures: 'Hide profile pictures',
                allowRenameSelf: 'allow participant to Rename Themselves',
                allowUnmuteSelf: 'allow participant to Unmute Themselves',
                allowStartVideo: 'allow participant to Start Video',
                focusMode: 'Focus mode'
            };
            Object.keys(hostSwitchMap).forEach(function(k) {
                var sw = doc.querySelector('input.prism-SwitchBase-input[role="switch"][aria-label^="' + hostSwitchMap[k] + '"]');
                if (sw) {
                    state[k] = sw.getAttribute('aria-checked') === 'true';
                }
            });
        }

        // 4. Screen Sharing State
        var shareLayout = doc.querySelector('.sharing-layout, #sharee-container');
        var shareTip = doc.querySelector('.sharee-sharing-indicator__tip');
        var isViewingShare = isVisible(shareLayout) && !!shareTip && shareTip.textContent.trim() !== '';
        state.screenSharing = isViewingShare;
        if (isViewingShare) {
            var tipText = shareTip.textContent.trim();
            var sharerMatch = tipText.match(/viewing\s+(.+?)'s\s+screen/i);
            state.screenSharer = sharerMatch ? sharerMatch[1].trim() : tipText;
        } else {
            state.screenSharer = '';
        }
        state.localSharing = isVisible(doc.querySelector('.sharer-controlbar-container__main-area'));

        // 5. Current View & Panel Open States
        var checkedView = doc.querySelector('.full-screen-widget__pop-menu--checked');
        if (checkedView) {
            state.currentView = (checkedView.getAttribute('aria-label') || '').trim();
        } else {
            var viewSvg = doc.querySelector('button.full-screen-widget__button[aria-label="View"] svg');
            if (viewSvg) {
                var svgCls = viewSvg.getAttribute('class') || '';
                if (svgCls.indexOf('Gallery') !== -1) state.currentView = 'Gallery View';
                else if (svgCls.indexOf('Speaker') !== -1) state.currentView = 'Speaker View';
                else if (svgCls.indexOf('Multi') !== -1) state.currentView = 'Multi-speaker View';
            }
        }
        state.participantsPanelOpen = isVisible(doc.querySelector('.participants-section-container'));
        state.chatPanelOpen = isVisible(doc.querySelector('.chat-container'));

        var recBtn = doc.querySelector('button.chat-receiver-list__receiver');
        if (recBtn && isVisible(recBtn)) {
            state.chatRecipient = recBtn.textContent.trim();
        }

        // 6. Participants Count (note: Zoom uses "particpants" typo in aria-label)
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

        // 7. Active Speaker (Participants speaking icon first, then tile fallback)
        var speakingIcon = doc.querySelector('.item-pos.participants-li .participants-icon__voip-speaking-icon');
        if (speakingIcon) {
            var speakingRow = speakingIcon.closest('.participants-li');
            if (speakingRow) {
                var sAria = speakingRow.getAttribute('aria-label') || '';
                state.activeSpeaker = (sAria.split(',')[0] || '').replace(/\s*\((Host|Co-host|Me)\)\s*$/i, '').trim();
            }
        } else {
            var activeSpeakerEl = doc.querySelector('.active-speaker, [class*="active-speaker"], [class*="speaker-active"]');
            if (activeSpeakerEl) {
                state.activeSpeaker = activeSpeakerEl.textContent.trim();
            } else {
                var speakerThumbnail = doc.querySelector('.speaker-highlight, [class*="speaker-highlight"], [style*="border-color: rgb(45, 140, 255)"]');
                if (speakerThumbnail) {
                    state.activeSpeaker = speakerThumbnail.textContent.trim();
                }
            }
        }

        // Detect and dispatch state changes
        var changes = { event: 'stateUpdate' };
        var hasChanges = false;

        [
            'meetingTitle', 'muted', 'videoOff', 'handRaised', 'isHost',
            'waitingRoomEnabled', 'meetingLocked', 'hideProfilePictures',
            'allowRenameSelf', 'allowUnmuteSelf', 'allowStartVideo', 'focusMode',
            'screenSharing', 'screenSharer', 'localSharing', 'currentView',
            'participantsPanelOpen', 'chatPanelOpen', 'chatRecipient',
            'activeSpeaker', 'participantsCount'
        ].forEach(function(key) {
            if (state[key] !== lastState[key] && state[key] !== undefined && state[key] !== null) {
                lastState[key] = state[key];
                changes[key] = state[key];
                hasChanges = true;
            }
        });

        // 8. Per-Participant Status & Leave Detection
        var participants = scrapeParticipants(doc) || {};
        var currentNames = Object.keys(participants);

        Object.keys(lastParticipantNames).forEach(function(prevName) {
            if (!participants[prevName]) {
                delete lastTileReactions[prevName];
                sendToChataigne({
                    event: 'participantLeft',
                    removedParticipant: prevName
                });
            }
        });
        lastParticipantNames = {};
        currentNames.forEach(function(n) { lastParticipantNames[n] = true; });

        if (currentNames.length > 0) {
            var participantsJson = JSON.stringify(participants);
            if (participantsJson !== lastState.participantsJson) {
                lastState.participantsJson = participantsJson;
                changes.participants = participants;
                hasChanges = true;
            }
        } else if (lastState.participantsJson !== null) {
            lastState.participantsJson = null;
        }

        if (hasChanges) {
            sendToChataigne(changes);
        }

        // Keep checking if observers need setup or cleanup
        checkChatObserver();
        checkReactionObserver();
    }

    // 9. Chat Messages Observer
    var observedChatContainer = null;
    var chatObserver = null;

    function checkChatObserver() {
        var doc = getZoomDocument();
        var chatContainer = doc.querySelector('.chat-container__chat-list [data-testid="virtuoso-item-list"], .chat-list, [class*="chat-list"], [class*="chat-messages"]');

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

    // 10. Reactions Observer (user & participant floating emoji reactions)
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
