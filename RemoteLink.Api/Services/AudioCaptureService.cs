using System.Runtime.InteropServices;
using Microsoft.AspNetCore.SignalR;
using NAudio.Wave;
using RemoteLink.Api.Hubs;

namespace RemoteLink.Api.Services;

public sealed class AudioCaptureService : IHostedService, IDisposable
{
    private readonly IHubContext<ScreenHub> _hub;
    private readonly ScreenClientTracker _tracker;
    private readonly ILogger<AudioCaptureService> _logger;

    private WasapiLoopbackCapture? _capture;
    private int _sampleRate;
    private int _channels;
    private readonly object _lock = new();

    public AudioCaptureService(
        IHubContext<ScreenHub> hub,
        ScreenClientTracker tracker,
        ILogger<AudioCaptureService> logger)
    {
        _hub     = hub;
        _tracker = tracker;
        _logger  = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StopAsync(CancellationToken cancellationToken)
    {
        lock (_lock) StopCapture();
        return Task.CompletedTask;
    }

    public void OnClientEnabled()
    {
        lock (_lock)
        {
            if (_capture == null) StartCapture();
        }
    }

    public void OnClientDisabled()
    {
        lock (_lock)
        {
            if (_tracker.AudioClientCount == 0) StopCapture();
        }
    }

    private void StartCapture()
    {
        try
        {
            _capture             = new WasapiLoopbackCapture();
            _sampleRate          = _capture.WaveFormat.SampleRate;
            _channels            = _capture.WaveFormat.Channels;
            _capture.DataAvailable += OnDataAvailable;
            _capture.RecordingStopped += OnRecordingStopped;
            _capture.StartRecording();
            _logger.LogInformation("Audio capture started ({Rate} Hz, {Ch} ch)", _sampleRate, _channels);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Audio capture failed to start: {Message}", ex.Message);
            _capture?.Dispose();
            _capture = null;
        }
    }

    private void StopCapture()
    {
        if (_capture == null) return;
        _capture.StopRecording();
        _capture.DataAvailable    -= OnDataAvailable;
        _capture.RecordingStopped -= OnRecordingStopped;
        _capture.Dispose();
        _capture = null;
        _logger.LogInformation("Audio capture stopped");
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded == 0 || _tracker.AudioClientCount == 0) return;

        // WASAPI loopback always delivers IEEE Float32. Convert to Int16 to halve bandwidth.
        var floats  = MemoryMarshal.Cast<byte, float>(e.Buffer.AsSpan(0, e.BytesRecorded));
        var int16   = new short[floats.Length];
        for (int i = 0; i < floats.Length; i++)
            int16[i] = (short)Math.Clamp((int)(floats[i] * 32767f), short.MinValue, short.MaxValue);

        var bytes  = MemoryMarshal.AsBytes<short>(int16).ToArray();
        var base64 = Convert.ToBase64String(bytes);

        // Fire and forget — SignalR sends are async but we don't need to await here
        _ = _hub.Clients.Group("audio").SendAsync("ReceiveAudio", base64, _sampleRate, _channels);
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null)
            _logger.LogWarning("Audio capture stopped with error: {Message}", e.Exception.Message);
    }

    public void Dispose()
    {
        lock (_lock) StopCapture();
    }
}
