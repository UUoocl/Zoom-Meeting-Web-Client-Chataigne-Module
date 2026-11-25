/*
  Zoom Meeting Web Client Custom Module (WebSocket Server + JSON Events & Commands)
  Receives Zoom Web Client meeting state, participant status, reactions, and chat events
  over WebSocket from zoom_console_injector.js, and sends control commands back over
  the same WebSocket connection.
*/

function init()
{
}

function wsMessageReceived(connectionId, message)
{
	if (local.values.responseReceived)
	{
		local.values.responseReceived.trigger();
	}
}

function moduleValueChanged(value)
{
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
	else if (value.name == "muted" || value.name == "videoOff" || value.name == "handRaised" || value.name == "activeSpeaker" || value.name == "participantsCount" || value.name == "meetingTitle")
	{
		if (local.values.onStateChanged)
		{
			local.values.onStateChanged.trigger();
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

function sendChatMessage(message)
{
	if (!message || message === "")
	{
		script.logWarning("Chat message is empty");
		return;
	}
	local.send('{"action":"sendChatMessage","message":"' + escapeJson(message) + '"}');
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
