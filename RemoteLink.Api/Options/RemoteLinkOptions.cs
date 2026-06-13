namespace RemoteLink.Api.Options;

public sealed class RemoteLinkOptions
{
    public const string Section = "RemoteLink";

    public string Password { get; set; } = "changeme";
    public string UploadPath { get; set; } = "Uploads";
    public string ChatLogPath { get; set; } = "ChatLogs";
}
