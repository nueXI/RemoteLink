using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using RemoteLink.Api.Options;

namespace RemoteLink.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(IOptions<RemoteLinkOptions> options) : ControllerBase
{
    private readonly RemoteLinkOptions _options = options.Value;

    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest req)
    {
        if (req.Password != _options.Password)
            return Unauthorized();

        return Ok(new { token = _options.Password });
    }
}

public record LoginRequest(string Password);
