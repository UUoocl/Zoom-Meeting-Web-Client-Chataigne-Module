# Zoom Meeting Web Client Custom Module (WebSocket Server)

A Chataigne community custom module based on `WebSocket Server` that receives and parses Zoom Web Client meeting events (active speaker, mute, video, participant count, and chat messages) sent over WebSocket by the included [zoom_console_injector.js](zoom_console_injector.js) browser console script.

## Architecture

```
Browser (Zoom Web Client: https://app.zoom.us/wc/)
  └── zoom_console_injector.js (DevTools console)
        ├── Polls DOM (1s): muted, videoOff, activeSpeaker, participantsCount
        ├── MutationObserver: chat container for new messages
        └── WebSocket client (ws://127.0.0.1:8080, auto-reconnect)
              └── sends flat JSON payloads
                    ▼
Chataigne (Zoom Meeting Web Client / WebSocket Server, Protocol: JSON)
  ├── Auto-parses JSON into pre-declared Chataigne Values
  └── zoomWebClient.js
        ├── fires responseReceived / onStateChanged / onChatMessage triggers
        └── logs errors via script.logWarning
```

## Features

- Pre-configured `WebSocket Server` in `JSON` mode on port `8080` (`ws://127.0.0.1:8080`).
- Pre-declared read-only Chataigne Values for immediate Mapping and State binding:
  - `connectionStatus`, `activeSpeaker`, `muted`, `videoOff`, `participantsCount`, `lastChatSender`, `lastChatMessage`, `event`, `error`
- Convenience Triggers:
  - `responseReceived` — fires on every incoming WebSocket message.
  - `onStateChanged` — fires when `muted`, `videoOff`, `activeSpeaker`, or `participantsCount` changes.
  - `onChatMessage` — fires when a new chat message arrives (`lastChatSender` / `lastChatMessage`).

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

### State Update
```json
{
  "event": "stateUpdate",
  "muted": true,
  "videoOff": false,
  "activeSpeaker": "Jane Doe",
  "participantsCount": 5
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
