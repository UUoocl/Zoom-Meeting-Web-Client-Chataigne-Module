/*
  Zoom Meeting Web Client Custom Module (WebSocket Server + JSON Events & Commands)
  Receives Zoom Web Client meeting state, participant status, reactions, and chat events
  over WebSocket from zoom_console_injector.js, and sends control commands back over
  the same WebSocket connection.
*/

var isInitializing = false;

var DEFAULT_VALUES = {
	connectionStatus: "disconnected",
	meetingTitle: "",
	activeSpeaker: "",
	muted: false,
	videoOff: false,
	handRaised: false,
	isHost: false,
	waitingRoomEnabled: false,
	meetingLocked: false,
	hideProfilePictures: false,
	allowRenameSelf: true,
	allowUnmuteSelf: true,
	allowStartVideo: true,
	focusMode: false,
	screenSharing: false,
	screenSharer: "",
	localSharing: false,
	currentView: "",
	participantsPanelOpen: false,
	chatPanelOpen: false,
	chatRecipient: "",
	participantsCount: 0,
	removedParticipant: "",
	lastChatSender: "",
	lastChatMessage: "",
	lastReactionSender: "",
	lastReactionEmoji: "",
	lastReactionCode: "",
	reactionCount: 0,
	event: "",
	error: ""
};

var STATE_KEYS = [
	"muted", "videoOff", "handRaised", "isHost", "waitingRoomEnabled",
	"meetingLocked", "hideProfilePictures", "allowRenameSelf", "allowUnmuteSelf",
	"allowStartVideo", "focusMode", "activeSpeaker", "participantsCount",
	"meetingTitle", "screenSharing", "screenSharer", "localSharing",
	"currentView", "participantsPanelOpen", "chatPanelOpen", "chatRecipient"
];

function clearParticipants()
{
	if (!local.values.participants) return;
	if (typeof local.values.removeContainer == "function")
	{
		local.values.removeContainer("participants");
	}
	else if (typeof local.values.participants.clear == "function")
	{
		local.values.participants.clear();
	}
}

function removeParticipant(name)
{
	if (!name || name === "" || !local.values.participants) return;
	if (typeof local.values.participants.removeContainer == "function")
	{
		local.values.participants.removeContainer(name);
	}
}

function clearValues()
{
	isInitializing = true;
	var keys = [
		"connectionStatus", "meetingTitle", "activeSpeaker", "muted", "videoOff",
		"handRaised", "isHost", "waitingRoomEnabled", "meetingLocked",
		"hideProfilePictures", "allowRenameSelf", "allowUnmuteSelf",
		"allowStartVideo", "focusMode", "screenSharing", "screenSharer",
		"localSharing", "currentView", "participantsPanelOpen", "chatPanelOpen",
		"chatRecipient", "participantsCount", "removedParticipant",
		"lastChatSender", "lastChatMessage", "lastReactionSender",
		"lastReactionEmoji", "lastReactionCode", "reactionCount", "event", "error"
	];
	for (var i = 0; i < keys.length; i++)
	{
		var k = keys[i];
		if (local.values[k])
		{
			local.values[k].set(DEFAULT_VALUES[k]);
		}
	}
	clearParticipants();
	isInitializing = false;
}

function init()
{
	clearValues();
}

function wsMessageReceived(connectionId, message)
{
	if (local.values.responseReceived)
	{
		local.values.responseReceived.trigger();
	}
}

function isStateKey(name)
{
	for (var i = 0; i < STATE_KEYS.length; i++)
	{
		if (STATE_KEYS[i] == name) return true;
	}
	return false;
}

function moduleValueChanged(value)
{
	if (isInitializing) return;

	if (value.name == "lastChatMessage" || value.name == "lastChatSender")
	{
		if (local.values.onChatMessage)
		{
			local.values.onChatMessage.trigger();
		}
	}
	else if (value.name == "reactionCount")
	{
		if (local.values.onReaction)
		{
			local.values.onReaction.trigger();
		}
	}
	else if (isStateKey(value.name))
	{
		if (local.values.onStateChanged)
		{
			local.values.onStateChanged.trigger();
		}
	}
	else if (value.name == "removedParticipant")
	{
		var leftName = value.get();
		if (leftName != "")
		{
			removeParticipant(leftName);
		}
	}
	else if (value.name == "error")
	{
		var err = value.get();
		if (err != "")
		{
			script.logWarning("Zoom Web Client error: " + err);
		}
	}
}

function escapeJson(str)
{
	var s = "" + str;
	var out = "";
	for (var i = 0; i < s.length; i++)
	{
		var c = s.charAt(i);
		if (c == "\\") out += "\\\\";
		else if (c == "\"") out += "\\\"";
		else if (c == "\n") out += "\\n";
		else if (c == "\r") out += "\\r";
		else if (c == "\t") out += "\\t";
		else out += c;
	}
	return out;
}

function sendChatMessage(message, recipient)
{
	if (!message || message === "")
	{
		script.logWarning("Chat message is empty");
		return;
	}
	var recPart = (recipient && recipient !== "") ? ',"recipient":"' + escapeJson(recipient) + '"' : "";
	local.send('{"action":"sendChatMessage","message":"' + escapeJson(message) + '"' + recPart + '}');
}

function sendReaction(reaction)
{
	if (!reaction || reaction === "")
	{
		script.logWarning("Reaction is empty");
		return;
	}
	local.send('{"action":"sendReaction","reaction":"' + escapeJson(reaction) + '"}');
}

function setMute(muted)
{
	local.send('{"action":"setMute","value":' + (muted ? "true" : "false") + '}');
}

function setVideo(videoOff)
{
	local.send('{"action":"setVideo","value":' + (videoOff ? "true" : "false") + '}');
}

function setHandRaised(raised)
{
	local.send('{"action":"setHandRaised","value":' + (raised ? "true" : "false") + '}');
}

function setView(view)
{
	if (!view || view === "") return;
	local.send('{"action":"setView","view":"' + escapeJson(view) + '"}');
}

function setParticipantsPanel(open)
{
	local.send('{"action":"setParticipantsPanel","value":' + (open ? "true" : "false") + '}');
}

function setChatPanel(open)
{
	local.send('{"action":"setChatPanel","value":' + (open ? "true" : "false") + '}');
}

function pinParticipant(participantName)
{
	if (!participantName || participantName === "")
	{
		script.logWarning("Participant Name is empty");
		return;
	}
	local.send('{"action":"pinParticipant","name":"' + escapeJson(participantName) + '"}');
}

function toggleCaptions()
{
	local.send('{"action":"moreAction","item":"Show Captions"}');
}

function toggleRecord()
{
	local.send('{"action":"moreAction","item":"Record"}');
}

function toggleStopIncomingVideo()
{
	local.send('{"action":"moreAction","item":"Stop Incoming Video"}');
}

function screenShareAction(action)
{
	local.send('{"action":"screenShareAction","mode":"' + escapeJson(action) + '"}');
}

function selectAudioDevice(deviceName)
{
	if (!deviceName || deviceName === "")
	{
		script.logWarning("Device Name is empty");
		return;
	}
	local.send('{"action":"selectAudioDevice","name":"' + escapeJson(deviceName) + '"}');
}

function selectVideoDevice(deviceName)
{
	if (!deviceName || deviceName === "")
	{
		script.logWarning("Device Name is empty");
		return;
	}
	local.send('{"action":"selectVideoDevice","name":"' + escapeJson(deviceName) + '"}');
}

function toggleNoiseSuppression()
{
	local.send('{"action":"toggleNoiseSuppression"}');
}

function muteAll()
{
	local.send('{"action":"muteAll"}');
}

function askAllToUnmute()
{
	local.send('{"action":"participantsMoreAction","item":"Ask all to unmute"}');
}

function toggleMuteUponEntry()
{
	local.send('{"action":"participantsMoreAction","item":"Mute all upon entry"}');
}

function participantHostAction(participantName, action)
{
	if (!participantName || participantName === "")
	{
		script.logWarning("Participant Name is empty");
		return;
	}
	local.send('{"action":"participantHostAction","name":"' + escapeJson(participantName) + '","item":"' + escapeJson(action) + '"}');
}

function setHostOption(option, enabled)
{
	local.send('{"action":"setHostOption","option":"' + escapeJson(option) + '","value":' + (enabled ? "true" : "false") + '}');
}

function suspendParticipantActivities()
{
	local.send('{"action":"suspendParticipantActivities"}');
}

function openBreakoutRooms()
{
	local.send('{"action":"moreAction","item":"Breakout Rooms"}');
}

function leaveOrEndMeeting(action)
{
	local.send('{"action":"leaveOrEndMeeting","mode":"' + escapeJson(action) + '"}');
}
