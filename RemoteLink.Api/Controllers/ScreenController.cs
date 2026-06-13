using Microsoft.AspNetCore.Mvc;
using RemoteLink.Api.Services;
using System.Windows.Forms;

namespace RemoteLink.Api.Controllers;

[ApiController]
[Route("api/screen")]
public sealed class ScreenController(ScreenClientTracker tracker, H264Encoder h264) : ControllerBase
{
    [HttpGet("monitors")]
    public IActionResult GetMonitors()
    {
        var screens = Screen.AllScreens;
        var monitors = screens.Select((s, i) => new
        {
            Index   = i,
            Width   = s.Bounds.Width,
            Height  = s.Bounds.Height,
            Primary = s.Primary,
            Name    = $"Display {i + 1}"
        });
        return Ok(new { monitors, currentIndex = tracker.ScreenIndex, h264Available = h264.IsAvailable });
    }
}
