# Zoom Meeting Web Client Custom Module (WebSocket Server)

A Chataigne community custom module based on `WebSocket Server` that receives Zoom Web Client meeting events and sends bidirectional control commands over WebSocket via the included [zoom_console_injector.js](zoom_console_injector.js) browser console script.

## Architecture

```
Browser (Zoom Web Client: https://app.zoom.us/wc/)
  └── zoom_console_injector.js (DevTools console)
        ├── Polls DOM (1s): meetingTitle, muted, videoOff, handRaised, screenSharing,
        │                   screenSharer, localSharing, currentView, panel states,
        │                   chatRecipient, activeSpeaker, participantsCount
        ├── Scrapes video tiles & participants list: per-participant state & leave events
        ├── MutationObserver: chat messages & floating emoji reactions
        └── WebSocket client (ws://127.0.0.1:8080, auto-reconnect)
              ▲▼ Bidirectional JSON messages
Chataigne (Zoom Meeting Web Client / WebSocket Server, Protocol: JSON)
  ├── Auto-parses incoming JSON into pre-declared & dynamic Chataigne Values
  └── zoomWebClient.js
        ├── Clears all values & participants on load
        ├── Fires responseReceived / onStateChanged / onChatMessage / onReaction triggers
        └── Sends control commands back over WebSocket
```

## Features

- Pre-configured `WebSocket Server` in `JSON` mode on port `8080` (`ws://127.0.0.1:8080`).
- **Pre-declared read-only Chataigne Values:**
  - `connectionStatus`, `meetingTitle`, `activeSpeaker`, `muted`, `videoOff`, `handRaised`, `isHost`, `waitingRoomEnabled`, `meetingLocked`, `hideProfilePictures`, `allowRenameSelf`, `allowUnmuteSelf`, `allowStartVideo`, `focusMode`, `screenSharing`, `screenSharer`, `localSharing`, `currentView`, `participantsPanelOpen`, `chatPanelOpen`, `chatRecipient`, `participantsCount`, `removedParticipant`, `lastChatSender`, `lastChatMessage`, `lastReactionSender`, `lastReactionEmoji`, `lastReactionCode`, `reactionCount`, `event`, `error`
- **Dynamic per-participant Values** (auto-cleared on load, removed when participants leave):
  - `participants.<name>.muted`, `participants.<name>.videoOff`, `participants.<name>.handRaised`, `participants.<name>.reaction`, `participants.<name>.reactionCode`, `participants.<name>.role`
- **Convenience Triggers:**
  - `responseReceived` — fires on every incoming WebSocket message.
  - `onStateChanged` — fires when meeting state values change.
  - `onChatMessage` — fires when a new chat message arrives (`lastChatSender` / `lastChatMessage`).
  - `onReaction` — fires when a user or participant sends a reaction (`lastReactionSender` / `lastReactionEmoji` / `lastReactionCode`).
- **Bidirectional Commands (Chataigne → Zoom Web Client):**
  - **Send Chat Message** (`Message`, optional `Recipient`)
  - **Send Reaction** (`Reaction` Enum: `Clapping Hands`, `Thumbs Up`, `Tears of Joy`, `Open Mouth`, `Red Heart`, `Party Popper`, `Yes`, `No`, `Slow down`, `Speed up`, `I'm away`, `Be right back`)
  - **Set Mute** (`Muted`)
  - **Set Video** (`Video Off`)
  - **Set Hand Raised** (`Raised`)
  - **Set View** (`Speaker View`, `Gallery View`, `Multi-speaker View`, `Hide Self View`, `Hide Non-video Participants`, `Fullscreen`)
  - **Set Participants Panel** (`Open`)
  - **Set Chat Panel** (`Open`)
  - **Pin Participant** (`Participant Name`)
  - **Toggle Captions** / **Toggle Record** / **Toggle Stop Incoming Video**
  - **Screen Share Action** (`Open Share`, `Pause Share`, `Stop Share`)
  - **Select Audio Device** (`Device Name`) / **Select Video Device** (`Device Name`) / **Toggle Noise Suppression**
- **Host Commands (Chataigne → Zoom Web Client, under `Host`):**
  - **Mute All** / **Ask All to Unmute** / **Toggle Mute Upon Entry**
  - **Participant Host Action** (`Participant Name`, `Action`: `Mute`, `Ask to Unmute`, `Stop Video`, `Ask For Start Video`, `Spotlight for Everyone`, `Make Host`, `Make Co-Host`, `Put in Waiting Room`, `Remove`)
  - **Set Host Option** (`Option`: `Lock Meeting`, `Enable Waiting Room`, `Hide Profile Pictures`, `Allow Rename Themselves`, `Allow Unmute Themselves`, `Allow Start Video`, `Focus Mode`; `Enabled`: Boolean)
  - **Suspend Participant Activities** / **Open Breakout Rooms**
  - **Leave or End Meeting** (`Leave Meeting`, `End Meeting for All`)

## Installation

Copy or symlink this folder into Chataigne's custom modules directory:

```bash
ln -s "$(pwd)" ~/Documents/Chataigne/modules/"Zoom Meeting Web Client"
```

(Or place it in a `modules/Zoom Meeting Web Client` folder next to your `.noisette` project file.)

## Setup in Chataigne & Browser

1. In Chataigne, add **Software → Zoom Meeting Web Client**:
   - Default **Local Port** is `8080` (adjust if needed).
2. Open your Zoom meeting in the browser (`https://app.zoom.us/wc/...`).
3. Open the browser's Developer Tools console (`F12` / `Cmd+Option+J`), paste the contents of [zoom_console_injector.js](zoom_console_injector.js), and press Enter.
   - If you changed the Chataigne **Local Port**, update `wsUrl` at the top of `zoom_console_injector.js` before pasting.
   - Note: If Zoom's Content Security Policy (`connect-src`) blocks `ws://127.0.0.1:8080` in your browser, check the browser console for CSP errors.
