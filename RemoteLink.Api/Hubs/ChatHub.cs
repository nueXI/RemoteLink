using Microsoft.AspNetCore.SignalR;
using RemoteLink.Api.Services;

namespace RemoteLink.Api.Hubs;

public class ChatHub(ChatLogService logService) : Hub
{
    public async Task SendMessage(string sender, string message)
    {
        var timestamp = DateTime.UtcNow;
        await Clients.All.SendAsync("ReceiveMessage", sender, message, timestamp);
        await logService.AppendAsync(new ChatLogEntry(sender, message, timestamp));
    }
}

