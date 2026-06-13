using Microsoft.AspNetCore.SignalR;
using RemoteLink.Api.Services;
using System.Windows.Forms;

namespace RemoteLink.Api.Hubs;

public sealed class ScreenHub(ScreenClientTracker tracker, RemoteInputService input) : Hub
{
    public override Task OnConnectedAsync()
    {
        tracker.Increment();
        return base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        tracker.Decrement();
        return base.OnDisconnectedAsync(exception);
    }

    public void SelectScreen(int index)
    {
        if (index >= 0 && index < Screen.AllScreens.Length)
            tracker.SetScreen(index);
    }

    public void SelectMode(string mode)
    {
        var parsed = mode == "h264" ? StreamMode.H264 : StreamMode.Jpeg;
        tracker.SetStreamMode(parsed);
        if (parsed == StreamMode.H264) tracker.RequestKeyframe();
    }

    // Remote control — called by the phone client
    public void MouseMove(double ratioX, double ratioY)
        => input.MoveMouse(ratioX, ratioY, tracker.ScreenIndex);

    public void MouseButton(int button, bool down)
        => input.MouseButton(button, down);

    public void MouseScroll(int delta)
        => input.MouseScroll(delta);

    public void KeyType(string text)
        => input.TypeText(text);

    public void KeyPress(ushort vk)
        => input.KeyPress(vk);
}
