using System.Text.Json;
using Microsoft.Extensions.Options;
using RemoteLink.Api.Options;

namespace RemoteLink.Api.Services;

public record ChatLogEntry(string Sender, string Message, DateTime Timestamp);

public sealed class ChatLogService(IOptions<RemoteLinkOptions> options)
{
    private readonly string _logPath = Path.GetFullPath(options.Value.ChatLogPath);
    private readonly SemaphoreSlim _lock = new(1, 1);

    private static readonly JsonSerializerOptions WriteOptions =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly JsonSerializerOptions ReadOptions =
        new() { PropertyNameCaseInsensitive = true };

    public async Task AppendAsync(ChatLogEntry entry)
    {
        Directory.CreateDirectory(_logPath);
        var filePath = FilePath(DateOnly.FromDateTime(DateTime.Now));

        await _lock.WaitAsync();
        try
        {
            var entries = await ReadFileAsync(filePath);
            entries.Add(entry);
            await File.WriteAllTextAsync(filePath, JsonSerializer.Serialize(entries, WriteOptions));
        }
        finally
        {
            _lock.Release();
        }
    }

    public IEnumerable<string> GetDates()
    {
        if (!Directory.Exists(_logPath)) return [];
        return Directory.GetFiles(_logPath, "????-??-??.json")
            .Select(f => Path.GetFileNameWithoutExtension(f))
            .Order()
            .Reverse();
    }

    public async Task<List<ChatLogEntry>> GetEntriesAsync(string date) =>
        await ReadFileAsync(FilePath(date));

    public bool Delete(string date)
    {
        var path = FilePath(date);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    private string FilePath(DateOnly date) => FilePath(date.ToString("yyyy-MM-dd"));
    private string FilePath(string date) => Path.Combine(_logPath, $"{date}.json");

    private async Task<List<ChatLogEntry>> ReadFileAsync(string path)
    {
        if (!File.Exists(path)) return [];
        var json = await File.ReadAllTextAsync(path);
        return JsonSerializer.Deserialize<List<ChatLogEntry>>(json, ReadOptions) ?? [];
    }
}
