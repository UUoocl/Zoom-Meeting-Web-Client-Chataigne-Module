# Zoom Meeting Web Client Custom Module (WebSocket Server)

A Chataigne community custom module based on `WebSocket Server` that receives and parses Zoom Web Client meeting events (active speaker, mute, video, hand raised, reactions, per-participant audio/video status, participant count, and chat messages) sent over WebSocket by the included [zoom_console_injector.js](zoom_console_injector.js) browser console script.

## Architecture

```
Browser (Zoom Web Client: https://app.zoom.us/wc/)
  └── zoom_console_injector.js (DevTools console)
        ├── Polls DOM (1s): meetingTitle, muted, videoOff, handRaised, activeSpeaker, participantsCount
        ├── Scrapes video tiles: per-participant muted & videoOff status
        ├── MutationObserver: chat messages & floating emoji reactions
        └── WebSocket client (ws://127.0.0.1:8080, auto-reconnect)
              └── sends flat JSON payloads
                    ▼
Chataigne (Zoom Meeting Web Client / WebSocket Server, Protocol: JSON)
  ├── Auto-parses JSON into pre-declared & dynamic Chataigne Values
  └── zoomWebClient.js
        ├── fires responseReceived / onStateChanged / onChatMessage / onReaction triggers
        └── logs errors via script.logWarning
```

## Features

- Pre-configured `WebSocket Server` in `JSON` mode on port `8080` (`ws://127.0.0.1:8080`).
- Pre-declared read-only Chataigne Values for immediate Mapping and State binding:
  - `connectionStatus`, `meetingTitle`, `activeSpeaker`, `muted`, `videoOff`, `handRaised`, `participantsCount`, `lastChatSender`, `lastChatMessage`, `lastReactionSender`, `lastReactionEmoji`, `lastReactionCode`, `reactionCount`, `event`, `error`
- Dynamic per-participant Values (via Chataigne's `Auto Add` JSON parser):
  - `participants.<name>.muted`, `participants.<name>.videoOff`, `participants.<name>.handRaised`, `participants.<name>.reaction`, `participants.<name>.reactionCode`
- Convenience Triggers:
  - `responseReceived` — fires on every incoming WebSocket message.
  - `onStateChanged` — fires when `muted`, `videoOff`, `handRaised`, `activeSpeaker`, `participantsCount`, or `meetingTitle` changes.
  - `onChatMessage` — fires when a new chat message arrives (`lastChatSender` / `lastChatMessage`).
  - `onReaction` — fires when a user or participant sends a reaction (`lastReactionSender` / `lastReactionEmoji` / `lastReactionCode`).
- Bidirectional Commands (Chataigne → Zoom Web Client):
  - **Send Chat Message** (`Message`) — opens the chat panel if needed and sends a message via `.tiptap.ProseMirror`.
  - **Send Reaction** (`Reaction`) — opens the React picker if needed and triggers an emoji or nonverbal feedback (`clapping hands`, `thumbs up`, `face with tears of joy`, `face with open mouth`, `red heart`, `party popper`, `Yes`, `No`, `Slow down`, `Speed up`, `I'm away`, `Be right back`).
  - **Set Mute** (`Muted`)
  - **Set Video** (`Video Off`)
  - **Set Hand Raised** (`Raised`)

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

## JSON Payloads

### Connection Status
```json
{
  "event": "connectionStatus",
  "connectionStatus": "connected",
  "error": ""
}
```

### State Update & Per-Participant Status
```json
{
  "event": "stateUpdate",
  "meetingTitle": "Jonathan Wood's Zoom Meeting",
  "muted": true,
  "videoOff": false,
  "handRaised": true,
  "activeSpeaker": "Jane Doe",
  "participantsCount": 2,
  "participants": {
    "Jonathan Wood": {
      "muted": true,
      "videoOff": false,
      "handRaised": true,
      "reaction": "🎉",
      "reactionCode": "1f389"
    },
    "cables": {
      "muted": false,
      "videoOff": true,
      "handRaised": true,
      "reaction": "",
      "reactionCode": ""
    }
  }
}
```

### Reaction
```json
{
  "event": "reaction",
  "lastReactionSender": "You",
  "lastReactionEmoji": "👍",
  "lastReactionCode": "1f44d",
  "reactionCount": 1
}
```

### Chat Message
```json
{
  "event": "chatMessage",
  "lastChatSender": "Jane Doe",
  "lastChatMessage": "Hello everyone!"
}
```
