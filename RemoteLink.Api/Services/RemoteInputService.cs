using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace RemoteLink.Api.Services;

public sealed class RemoteInputService
{
    public void MoveMouse(double ratioX, double ratioY, int screenIndex)
    {
        var screens = Screen.AllScreens;
        var screen  = screenIndex < screens.Length ? screens[screenIndex] : Screen.PrimaryScreen!;
        var bounds  = screen.Bounds;

        int physX = bounds.X + (int)(ratioX * bounds.Width);
        int physY = bounds.Y + (int)(ratioY * bounds.Height);

        // Normalize to virtual-screen absolute coordinates (0–65535)
        int vsLeft   = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
        int vsTop    = GetSystemMetrics(77); // SM_YVIRTUALSCREEN
        int vsWidth  = GetSystemMetrics(78); // SM_CXVIRTUALSCREEN
        int vsHeight = GetSystemMetrics(79); // SM_CYVIRTUALSCREEN

        int nx = (int)((physX - vsLeft) * 65535.0 / vsWidth);
        int ny = (int)((physY - vsTop)  * 65535.0 / vsHeight);

        Send([Mouse(nx, ny, 0, MOVE | ABSOLUTE | VIRTUALDESK)]);
    }

    public void MouseButton(int button, bool down)
    {
        uint flag = (button, down) switch
        {
            (0, true)  => LEFTDOWN,
            (0, false) => LEFTUP,
            (1, true)  => RIGHTDOWN,
            (1, false) => RIGHTUP,
            (2, true)  => MIDDLEDOWN,
            (2, false) => MIDDLEUP,
            _ => 0
        };
        if (flag != 0) Send([Mouse(0, 0, 0, flag)]);
    }

    public void MouseScroll(int delta)
        => Send([Mouse(0, 0, (uint)delta, WHEEL)]);

    public void TypeText(string text)
    {
        if (string.IsNullOrEmpty(text)) return;
        var inputs = text.SelectMany(c => new[]
        {
            Key(0, c, UNICODE),
            Key(0, c, UNICODE | KEYUP)
        }).ToArray();
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    public void KeyPress(ushort vk)
        => Send([Key(vk, 0, 0), Key(vk, 0, KEYUP)]);

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static void Send(INPUT[] inputs)
        => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());

    private static INPUT Mouse(int dx, int dy, uint data, uint flags) => new()
    {
        type = INPUT_MOUSE,
        U    = new() { mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags } }
    };

    private static INPUT Key(ushort vk, ushort scan, uint flags) => new()
    {
        type = INPUT_KEYBOARD,
        U    = new() { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } }
    };

    // ── P/Invoke ─────────────────────────────────────────────────────────────

    [DllImport("user32.dll")] private static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern int  GetSystemMetrics(int n);

    private const uint INPUT_MOUSE    = 0;
    private const uint INPUT_KEYBOARD = 1;

    private const uint MOVE        = 0x0001;
    private const uint LEFTDOWN    = 0x0002;
    private const uint LEFTUP      = 0x0004;
    private const uint RIGHTDOWN   = 0x0008;
    private const uint RIGHTUP     = 0x0010;
    private const uint MIDDLEDOWN  = 0x0020;
    private const uint MIDDLEUP    = 0x0040;
    private const uint WHEEL       = 0x0800;
    private const uint ABSOLUTE    = 0x8000;
    private const uint VIRTUALDESK = 0x4000;

    private const uint KEYUP    = 0x0002;
    private const uint UNICODE  = 0x0004;

    [StructLayout(LayoutKind.Sequential)] private struct INPUT     { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)]   private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
}
