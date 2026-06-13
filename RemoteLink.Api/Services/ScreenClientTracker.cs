namespace RemoteLink.Api.Services;

public sealed class ScreenClientTracker
{
    private int _count;
    private int _screenIndex;
    private int _streamMode;    // StreamMode enum cast to int
    private int _forceKeyframe; // 0 or 1

    public int        ConnectionCount => _count;
    public int        ScreenIndex     => _screenIndex;
    public StreamMode StreamMode      => (StreamMode)Volatile.Read(ref _streamMode);

    public void Increment()  => Interlocked.Increment(ref _count);
    public void Decrement()  => Interlocked.Decrement(ref _count);
    public void SetScreen(int index) => Interlocked.Exchange(ref _screenIndex, index);

    public void SetStreamMode(StreamMode mode) =>
        Interlocked.Exchange(ref _streamMode, (int)mode);

    public void RequestKeyframe() =>
        Interlocked.Exchange(ref _forceKeyframe, 1);

    public bool ConsumeForceKeyframe() =>
        Interlocked.Exchange(ref _forceKeyframe, 0) == 1;
}
