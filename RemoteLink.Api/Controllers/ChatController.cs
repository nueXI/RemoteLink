using Microsoft.AspNetCore.Mvc;
using RemoteLink.Api.Services;

namespace RemoteLink.Api.Controllers;

[ApiController]
[Route("api/chat")]
public sealed class ChatController(ChatLogService logService) : ControllerBase
{
    [HttpGet("logs")]
    public IActionResult GetDates() => Ok(logService.GetDates());

    [HttpGet("logs/{date}")]
    public async Task<IActionResult> GetLog(string date)
    {
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out _))
            return BadRequest("Invalid date format");
        return Ok(await logService.GetEntriesAsync(date));
    }

    [HttpDelete("logs/{date}")]
    public IActionResult DeleteLog(string date)
    {
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out _))
            return BadRequest("Invalid date format");
        return logService.Delete(date) ? NoContent() : NotFound();
    }
}
