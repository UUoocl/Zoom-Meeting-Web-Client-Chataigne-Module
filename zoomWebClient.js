/*
  Zoom Meeting Web Client Custom Module (WebSocket Server + JSON Events)
  Receives Zoom Web Client meeting state and chat events over WebSocket
  from the companion zoom_console_injector.js browser console script.
  WebSocketServerModule parses incoming JSON into local.values when Protocol is JSON;
  this script fires convenience triggers and logs errors.
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
	else if (value.name == "muted" || value.name == "videoOff" || value.name == "activeSpeaker" || value.name == "participantsCount")
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
