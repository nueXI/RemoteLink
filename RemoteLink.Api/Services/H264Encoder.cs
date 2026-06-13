using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Sdcb.FFmpeg.Raw;

namespace RemoteLink.Api.Services;

public sealed unsafe class H264Encoder : IDisposable
{
    private AVCodecContext* _ctx;
    private AVFrame*        _frame;
    private AVPacket*       _pkt;
    private SwsContext*     _swsCtx;
    private int             _width;
    private int             _height;
    private long            _pts;
    private int             _forceKeyframe; // interlocked 0/1

    // SPS/PPS header bytes cached from ctx->extradata after avcodec_open2.
    // NVENC (and some other hw encoders) store SPS/PPS here instead of inlining
    // them in every keyframe packet.
    private byte[]? _extraData;
    private string? _cachedCodecString;

    public bool IsAvailable { get; private set; }
    public int  Width       => _width;
    public int  Height      => _height;

    public H264Encoder()
    {
        try
        {
            _ = ffmpeg.avcodec_version(); // probe — throws DllNotFoundException if DLLs are missing
            IsAvailable = true;
        }
        catch
        {
            IsAvailable = false;
        }
    }

    // Initialize (or re-initialize when dimensions change). Safe to call multiple times.
    public bool Initialize(int width, int height, int fps = 30)
    {
        if (!IsAvailable) return false;
        if (_ctx != null && _width == width && _height == height) return true;

        FreeEncoder();

        string[] tryCodecs = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
        AVCodecContext* ctx = null;

        foreach (var name in tryCodecs)
        {
            var codec = ffmpeg.avcodec_find_encoder_by_name(name);
            if (codec == null) continue;

            ctx = ffmpeg.avcodec_alloc_context3(codec);
            if (ctx == null) continue;

            ctx->width        = width;
            ctx->height       = height;
            ctx->pix_fmt      = AVPixelFormat.Yuv420p;
            ctx->time_base    = new AVRational { Num = 1, Den = fps };
            ctx->framerate    = new AVRational { Num = fps, Den = 1 };
            ctx->bit_rate     = 3_000_000;
            ctx->gop_size     = fps; // 1-second keyframe interval
            ctx->max_b_frames = 0;

            // Codec-specific low-latency presets
            switch (name)
            {
                case "libx264":
                    ffmpeg.av_opt_set(ctx->priv_data, "preset", "ultrafast", 0);
                    ffmpeg.av_opt_set(ctx->priv_data, "tune", "zerolatency", 0);
                    break;
                case "h264_nvenc":
                    ffmpeg.av_opt_set(ctx->priv_data, "preset", "p1", 0);
                    ffmpeg.av_opt_set(ctx->priv_data, "tune", "ull", 0);
                    ffmpeg.av_opt_set(ctx->priv_data, "delay", "0", 0);
                    break;
                case "h264_amf":
                    ffmpeg.av_opt_set(ctx->priv_data, "usage", "ultralowlatency", 0);
                    ffmpeg.av_opt_set(ctx->priv_data, "quality", "speed", 0);
                    break;
                case "h264_qsv":
                    ffmpeg.av_opt_set(ctx->priv_data, "preset", "veryfast", 0);
                    ffmpeg.av_opt_set(ctx->priv_data, "low_delay_brc", "1", 0);
                    break;
            }

            if (ffmpeg.avcodec_open2(ctx, codec, null) >= 0) break;

            var bad = ctx;
            ffmpeg.avcodec_free_context(&bad);
            ctx = null;
        }

        if (ctx == null) return false;

        // Cache SPS/PPS from extradata — hw encoders (NVENC, AMF) store it here
        // rather than inlining it in every keyframe packet.
        _extraData = null;
        _cachedCodecString = null;
        if (ctx->extradata != null && ctx->extradata_size > 0)
        {
            var extra = new byte[ctx->extradata_size];
            Marshal.Copy((IntPtr)ctx->extradata, extra, 0, ctx->extradata_size);
            _extraData = ToAnnexB(extra);
            _cachedCodecString = ExtractCodecString(_extraData);
        }

        var frame         = ffmpeg.av_frame_alloc();
        frame->width      = width;
        frame->height     = height;
        frame->format     = (int)AVPixelFormat.Yuv420p;
        ffmpeg.av_frame_get_buffer(frame, 0);

        var sws = ffmpeg.sws_getContext(
            width, height, AVPixelFormat.Bgr0,
            width, height, AVPixelFormat.Yuv420p,
            (int)SWS.Bilinear, null, null, null);

        _ctx    = ctx;
        _frame  = frame;
        _pkt    = ffmpeg.av_packet_alloc();
        _swsCtx = sws;
        _width  = width;
        _height = height;
        _pts    = 0;
        return true;
    }

    public void ForceNextKeyframe() =>
        Interlocked.Exchange(ref _forceKeyframe, 1);

    // Encode a bitmap and return a packet, or null if the encoder is buffering.
    public H264Frame? Encode(Bitmap bitmap)
    {
        if (_ctx == null || _swsCtx == null || _frame == null || _pkt == null)
            return null;

        var bmpData = bitmap.LockBits(
            new Rectangle(0, 0, bitmap.Width, bitmap.Height),
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppRgb);
        try
        {
            var srcPtr    = (byte*)bmpData.Scan0;
            var srcStride = bmpData.Stride;

            byte* zero     = null;
            var srcSlice   = new byte*[] { srcPtr, zero, zero, zero };
            var srcStrides = new int[]   { srcStride, 0, 0, 0 };
            var dstSlice   = new byte*[] { (byte*)_frame->data[0], (byte*)_frame->data[1], (byte*)_frame->data[2], zero };
            var dstStrides = new int[]   { _frame->linesize[0], _frame->linesize[1], _frame->linesize[2], 0 };

            ffmpeg.sws_scale(_swsCtx, srcSlice, srcStrides, 0, bitmap.Height, dstSlice, dstStrides);
        }
        finally
        {
            bitmap.UnlockBits(bmpData);
        }

        bool forceKey = Interlocked.Exchange(ref _forceKeyframe, 0) == 1;
        _frame->pict_type = forceKey ? AVPictureType.I : AVPictureType.None;
        _frame->pts = _pts++;

        ffmpeg.avcodec_send_frame(_ctx, _frame);

        int ret = ffmpeg.avcodec_receive_packet(_ctx, _pkt);
        if (ret < 0) return null; // EAGAIN or error

        bool isKey = (_pkt->flags & ffmpeg.AV_PKT_FLAG_KEY) != 0;
        var  raw   = new byte[_pkt->size];
        Marshal.Copy((IntPtr)_pkt->data, raw, 0, _pkt->size);
        ffmpeg.av_packet_unref(_pkt);

        if (!isKey) return new H264Frame(raw, false, null);

        // For keyframes: ensure SPS/PPS are present inline so WebCodecs can decode.
        // hw encoders put them only in extradata; software encoders inline them.
        byte[] data = HasSps(raw) ? raw : PrependExtraData(raw);

        string? codecStr = _cachedCodecString ?? ExtractCodecString(data);
        return new H264Frame(data, true, codecStr);
    }

    // Returns true if the packet already contains an SPS NAL (type 7).
    private static bool HasSps(byte[] data)
    {
        for (int i = 0; i < data.Length - 4; i++)
        {
            int nalOffset = -1;
            if (data[i] == 0 && data[i+1] == 0 && data[i+2] == 0 && data[i+3] == 1)
                nalOffset = i + 4;
            else if (data[i] == 0 && data[i+1] == 0 && data[i+2] == 1)
                nalOffset = i + 3;
            if (nalOffset >= 0 && nalOffset < data.Length && (data[nalOffset] & 0x1F) == 7)
                return true;
        }
        return false;
    }

    private byte[] PrependExtraData(byte[] packet)
    {
        if (_extraData == null || _extraData.Length == 0) return packet;
        var combined = new byte[_extraData.Length + packet.Length];
        Buffer.BlockCopy(_extraData, 0, combined, 0, _extraData.Length);
        Buffer.BlockCopy(packet, 0, combined, _extraData.Length, packet.Length);
        return combined;
    }

    // Converts AVCC-format extradata to Annex-B, or returns as-is if already Annex-B.
    private static byte[] ToAnnexB(byte[] extradata)
    {
        // Annex-B starts with 00 00 00 01 or 00 00 01
        if (extradata.Length >= 3 && extradata[0] == 0x00) return extradata;

        // AVCC format: version(1) profile(1) compat(1) level(1) nal_len_size(1) num_sps(1) ...
        // Convert each SPS/PPS unit to Annex-B
        if (extradata.Length < 7 || extradata[0] != 0x01) return extradata;

        using var ms = new MemoryStream();
        int pos = 5;
        int numSps = extradata[pos++] & 0x1F;
        for (int i = 0; i < numSps && pos + 2 <= extradata.Length; i++)
        {
            int len = (extradata[pos] << 8) | extradata[pos + 1]; pos += 2;
            if (pos + len > extradata.Length) break;
            ms.Write([0, 0, 0, 1]);
            ms.Write(extradata, pos, len); pos += len;
        }
        if (pos < extradata.Length)
        {
            int numPps = extradata[pos++];
            for (int i = 0; i < numPps && pos + 2 <= extradata.Length; i++)
            {
                int len = (extradata[pos] << 8) | extradata[pos + 1]; pos += 2;
                if (pos + len > extradata.Length) break;
                ms.Write([0, 0, 0, 1]);
                ms.Write(extradata, pos, len); pos += len;
            }
        }
        return ms.ToArray();
    }

    // Parses the SPS NAL unit (4-byte or 3-byte Annex-B start code) to produce
    // the WebCodecs codec string "avc1.PPCCLL".
    private static string? ExtractCodecString(byte[] data)
    {
        for (int i = 0; i < data.Length - 4; i++)
        {
            int nalOffset = -1;
            if (i + 4 < data.Length && data[i] == 0 && data[i+1] == 0 && data[i+2] == 0 && data[i+3] == 1)
                nalOffset = i + 4;
            else if (data[i] == 0 && data[i+1] == 0 && data[i+2] == 1)
                nalOffset = i + 3;

            if (nalOffset >= 0 && nalOffset + 3 < data.Length && (data[nalOffset] & 0x1F) == 7)
                return $"avc1.{data[nalOffset+1]:X2}{data[nalOffset+2]:X2}{data[nalOffset+3]:X2}";
        }
        return null;
    }

    public void Dispose() => FreeEncoder();

    private void FreeEncoder()
    {
        if (_swsCtx != null) { ffmpeg.sws_freeContext(_swsCtx); _swsCtx = null; }
        if (_frame  != null) { var f = _frame; ffmpeg.av_frame_free(&f);       _frame = null; }
        if (_pkt    != null) { var p = _pkt;   ffmpeg.av_packet_free(&p);       _pkt   = null; }
        if (_ctx    != null) { var c = _ctx;   ffmpeg.avcodec_free_context(&c); _ctx   = null; }
        _width = 0; _height = 0;
        _extraData = null;
        _cachedCodecString = null;
    }
}

public sealed record H264Frame(byte[] Data, bool IsKeyFrame, string? CodecString);
