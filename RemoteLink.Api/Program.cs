using Microsoft.Extensions.Options;
using RemoteLink.Api.Hubs;
using RemoteLink.Api.Options;
using RemoteLink.Api.Services;
using RunamiLogger;
using System.Windows.Forms;

// Must be set before any display calls so Screen.Bounds returns physical pixels on scaled/4K monitors.
Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

var builder = WebApplication.CreateBuilder(args);

builder.Logging.AddFileLogger(builder.Configuration);

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.Configure<RemoteLinkOptions>(
    builder.Configuration.GetSection(RemoteLinkOptions.Section));
builder.Services.AddSingleton<ScreenClientTracker>();
builder.Services.AddSingleton<H264Encoder>();
builder.Services.AddHostedService<ScreenCaptureService>();
builder.Services.AddSingleton<RemoteInputService>();
builder.Services.AddSingleton<ChatLogService>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

var app = builder.Build();

// Ensure uploads directory exists at startup
var remoteLinkOptions = app.Services.GetRequiredService<IOptions<RemoteLinkOptions>>().Value;
Directory.CreateDirectory(Path.GetFullPath(remoteLinkOptions.UploadPath));
Directory.CreateDirectory(Path.GetFullPath(remoteLinkOptions.ChatLogPath));

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

// Only protect /api/* routes (except login). Frontend and SignalR are always accessible.
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    bool requiresAuth = path.StartsWith("/api") && path != "/api/auth/login";
    if (requiresAuth)
    {
        var options = context.RequestServices.GetRequiredService<IOptions<RemoteLinkOptions>>().Value;
        var headerToken = context.Request.Headers.Authorization.FirstOrDefault()?.Replace("Bearer ", "");
        var queryToken = context.Request.Query["token"].FirstOrDefault();
        var token = headerToken ?? queryToken;
        if (token != options.Password)
        {
            context.Response.StatusCode = 401;
            return;
        }
    }
    await next();
});

app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.MapHub<ScreenHub>("/hubs/screen");
app.MapFallbackToFile("index.html");

app.Run();
