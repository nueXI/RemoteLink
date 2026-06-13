using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.AspNetCore.SignalR;
using RemoteLink.Api.Hubs;

namespace RemoteLink.Api.Services;

public sealed class ScreenCaptureService(
    IHubContext<ScreenHub> hubContext,
    ScreenClientTracker tracker,
    H264Encoder h264,
    ILogger<ScreenCaptureService> logger) : BackgroundService
{
    private bool _captureErrorLogged;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (tracker.ConnectionCount > 0)
            {
                try
                {
                    await CaptureAndSendAsync(stoppingToken);
                    _captureErrorLogged = false;
                }
                catch (Exception ex)
                {
                    if (!_captureErrorLogged)
                    {
                        logger.LogWarning("Screen capture failed (IIS Session 0 restriction?): {Message}", ex.Message);
                        _captureErrorLogged = true;
                    }
                    await Task.Delay(5_000, stoppingToken);
                }
            }
            else
            {
                await Task.Delay(100, stoppingToken);
            }
        }
    }

    private async Task CaptureAndSendAsync(CancellationToken ct)
    {
        var (bitmap, bounds) = CaptureBitmapWithCursor(tracker.ScreenIndex);
        using (bitmap)
        {
            if (tracker.StreamMode == StreamMode.H264 && h264.IsAvailable)
            {

                const int MaxWidth = 1920;
                Bitmap toEncode = bounds.Width > MaxWidth ? ScaleToWidth(bitmap, MaxWidth) : bitmap;
                try
                {
                    h264.Initialize(toEncode.Width, toEncode.Height);
                    if (tracker.ConsumeForceKeyframe()) h264.ForceNextKeyframe();

                    var frame = h264.Encode(toEncode);
                    if (frame != null)
                    {
                        var base64 = Convert.ToBase64String(frame.Data);
                        await hubContext.Clients.All.SendAsync(
                            "ReceiveH264Frame", base64, frame.IsKeyFrame, frame.CodecString, ct);
                    }
                }
                finally
                {
                    if (!ReferenceEquals(toEncode, bitmap)) toEncode.Dispose();
                }
            }
            else
            {
                var base64 = JpegEncode(bitmap, bounds);
                await hubContext.Clients.All.SendAsync("ReceiveFrame", base64, ct);
            }
        }
    }

    private static readonly ImageCodecInfo JpegEncoder =
        ImageCodecInfo.GetImageDecoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    private static string JpegEncode(Bitmap bitmap, Rectangle bounds)
    {
        const int MaxWidth = 1920;
        var toEncode = bounds.Width > MaxWidth ? ScaleToWidth(bitmap, MaxWidth) : bitmap;
        try
        {
            using var ms = new MemoryStream();
            using var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, 60L);
            toEncode.Save(ms, JpegEncoder, encoderParams);
            return Convert.ToBase64String(ms.ToArray());
        }
        finally
        {
            if (!ReferenceEquals(toEncode, bitmap)) toEncode.Dispose();
        }
    }

    private static (Bitmap, Rectangle) CaptureBitmapWithCursor(int screenIndex)
    {
        var screens = Screen.AllScreens;
        var screen  = screenIndex < screens.Length ? screens[screenIndex] : Screen.PrimaryScreen!;
        var bounds  = screen.Bounds;

        var capture = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb);
        using (var g = Graphics.FromImage(capture))
            g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);

        DrawCursor(capture, bounds);
        return (capture, bounds);
    }

    private static void DrawCursor(Bitmap bitmap, Rectangle screenBounds)
    {
        CursorInfo ci = new() { cbSize = Marshal.SizeOf<CursorInfo>() };
        if (!GetCursorInfo(out ci) || ci.flags != 1) return;

        int x = ci.ptScreenPos.x - screenBounds.X;
        int y = ci.ptScreenPos.y - screenBounds.Y;
        if (x < 0 || y < 0 || x >= screenBounds.Width || y >= screenBounds.Height) return;

        using var g = Graphics.FromImage(bitmap);
        var hdc = g.GetHdc();
        try { DrawIconEx(hdc, x, y, ci.hCursor, 0, 0, 0, IntPtr.Zero, 3); }
        finally { g.ReleaseHdc(hdc); }
    }

    private static Bitmap ScaleToWidth(Bitmap source, int targetWidth)
    {
        int targetHeight = (int)(source.Height * ((double)targetWidth / source.Width));
        var scaled = new Bitmap(targetWidth, targetHeight);
        using var g = Graphics.FromImage(scaled);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.DrawImage(source, 0, 0, targetWidth, targetHeight);
        return scaled;
    }

    [DllImport("user32.dll")] private static extern bool GetCursorInfo(out CursorInfo pci);
    [DllImport("user32.dll")] private static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int cx, int cy, int step, IntPtr hbr, int flags);

    [StructLayout(LayoutKind.Sequential)]
    private struct CursorInfo
    {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public CursorPoint ptScreenPos;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CursorPoint { public int x; public int y; }
}
