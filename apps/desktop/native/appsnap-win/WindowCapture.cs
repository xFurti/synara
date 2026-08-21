using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Synara.AppSnap
{
    sealed class SelectedWindow
    {
        public readonly IntPtr Handle;
        public readonly Rectangle Bounds;
        public readonly string SourceAppName;
        public readonly string SourceBundleIdentifier;
        public readonly string SourceAppIconDataUrl;
        public readonly string SourceWindowTitle;

        public SelectedWindow(
            IntPtr handle,
            Rectangle bounds,
            string sourceAppName,
            string sourceBundleIdentifier,
            string sourceAppIconDataUrl,
            string sourceWindowTitle
        )
        {
            Handle = handle;
            Bounds = bounds;
            SourceAppName = sourceAppName;
            SourceBundleIdentifier = sourceBundleIdentifier;
            SourceAppIconDataUrl = sourceAppIconDataUrl;
            SourceWindowTitle = sourceWindowTitle;
        }
    }

    static class NativeWindow
    {
        public const uint GA_ROOT = 2;
        public const uint PW_RENDERFULLCONTENT = 2;
        public const int DWMWA_CLOAKED = 14;
        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint TOKEN_QUERY = 0x0008;
        public const int TokenElevation = 20;
        public const uint TH32CS_SNAPPROCESS = 2;

        static readonly Guid IidPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        static readonly Guid AppUserModelFmtId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        const uint AppUserModelIdPid = 5;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PROPERTYKEY
        {
            public Guid fmtid;
            public uint pid;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct PROPVARIANT
        {
            [FieldOffset(0)]
            public ushort vt;
            [FieldOffset(8)]
            public IntPtr pointerValue;
        }

        [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        interface IPropertyStore
        {
            [PreserveSig]
            int GetCount(out uint cProps);
            [PreserveSig]
            int GetAt(uint iProp, out PROPERTYKEY pkey);
            [PreserveSig]
            int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
            [PreserveSig]
            int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
            [PreserveSig]
            int Commit();
        }

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(
            IntPtr hwnd,
            int dwAttribute,
            out int pvAttribute,
            int cbAttribute
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageName(
            IntPtr hProcess,
            int dwFlags,
            StringBuilder lpExeName,
            ref int lpdwSize
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        static extern bool GetTokenInformation(
            IntPtr TokenHandle,
            int TokenInformationClass,
            out int TokenInformation,
            int TokenInformationLength,
            out int ReturnLength
        );

        [DllImport("shell32.dll")]
        static extern int SHGetPropertyStoreForWindow(
            IntPtr hwnd,
            ref Guid riid,
            out IPropertyStore ppv
        );

        [DllImport("ole32.dll")]
        static extern void PropVariantClear(ref PROPVARIANT pvar);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr ExtractIcon(IntPtr hInst, string lpszExe, int nIconIndex);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool DestroyIcon(IntPtr hIcon);

        public static int CurrentProcessId
        {
            get { return Process.GetCurrentProcess().Id; }
        }

        public static int ParentProcessId(int processId)
        {
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1))
            {
                return 0;
            }

            try
            {
                var entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (!Process32First(snapshot, ref entry))
                {
                    return 0;
                }
                do
                {
                    if (entry.th32ProcessID == (uint)processId)
                    {
                        return (int)entry.th32ParentProcessID;
                    }
                } while (Process32Next(snapshot, ref entry));
            }
            finally
            {
                CloseHandle(snapshot);
            }
            return 0;
        }

        public static bool IsInProcessTree(uint pid, int ancestorPid)
        {
            int current = (int)pid;
            for (int depth = 0; depth < 24 && current > 0; depth++)
            {
                if (current == ancestorPid)
                {
                    return true;
                }
                int parent = ParentProcessId(current);
                if (parent == current)
                {
                    return false;
                }
                current = parent;
            }
            return false;
        }

        public static string WindowTitle(IntPtr hwnd)
        {
            var builder = new StringBuilder(1024);
            int length = GetWindowText(hwnd, builder, builder.Capacity);
            return length > 0 ? builder.ToString() : null;
        }

        public static bool IsCloaked(IntPtr hwnd)
        {
            int cloaked;
            if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, 4) != 0)
            {
                return false;
            }
            return cloaked != 0;
        }

        public static bool IsToolOrNonActivating(IntPtr hwnd)
        {
            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            return (exStyle & WS_EX_TOOLWINDOW) != 0 || (exStyle & WS_EX_NOACTIVATE) != 0;
        }

        public static string AppUserModelId(IntPtr hwnd)
        {
            Guid iid = IidPropertyStore;
            IPropertyStore store;
            if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) < 0 || store == null)
            {
                return null;
            }

            var key = new PROPERTYKEY { fmtid = AppUserModelFmtId, pid = AppUserModelIdPid };
            PROPVARIANT value;
            int hr = store.GetValue(ref key, out value);
            try
            {
                if (hr < 0 || value.vt != 31 || value.pointerValue == IntPtr.Zero)
                {
                    return null;
                }
                string text = Marshal.PtrToStringUni(value.pointerValue);
                return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
            }
            finally
            {
                PropVariantClear(ref value);
                Marshal.ReleaseComObject(store);
            }
        }

        public static string ProcessImagePath(uint pid)
        {
            IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (handle == IntPtr.Zero)
            {
                return null;
            }
            try
            {
                int size = 1024;
                var builder = new StringBuilder(size);
                if (!QueryFullProcessImageName(handle, 0, builder, ref size))
                {
                    return null;
                }
                string path = builder.ToString();
                return string.IsNullOrWhiteSpace(path) ? null : path;
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        public static bool IsElevated(uint pid)
        {
            IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero)
            {
                return false;
            }
            try
            {
                IntPtr token;
                if (!OpenProcessToken(process, TOKEN_QUERY, out token))
                {
                    return false;
                }
                try
                {
                    int elevation;
                    int length;
                    if (
                        !GetTokenInformation(
                            token,
                            TokenElevation,
                            out elevation,
                            4,
                            out length
                        )
                    )
                    {
                        return false;
                    }
                    return elevation != 0;
                }
                finally
                {
                    CloseHandle(token);
                }
            }
            finally
            {
                CloseHandle(process);
            }
        }

        public static string AppDisplayName(string imagePath, uint pid)
        {
            if (!string.IsNullOrEmpty(imagePath))
            {
                try
                {
                    var info = FileVersionInfo.GetVersionInfo(imagePath);
                    if (!string.IsNullOrWhiteSpace(info.FileDescription))
                    {
                        return info.FileDescription;
                    }
                    if (!string.IsNullOrWhiteSpace(info.ProductName))
                    {
                        return info.ProductName;
                    }
                }
                catch
                {
                }
                return Path.GetFileNameWithoutExtension(imagePath);
            }
            try
            {
                return Process.GetProcessById((int)pid).ProcessName;
            }
            catch
            {
                return null;
            }
        }

        public static string AppIconDataUrl(string imagePath)
        {
            if (string.IsNullOrEmpty(imagePath) || !File.Exists(imagePath))
            {
                return null;
            }

            IntPtr iconHandle = ExtractIcon(IntPtr.Zero, imagePath, 0);
            if (iconHandle == IntPtr.Zero)
            {
                return null;
            }

            try
            {
                using (Icon icon = Icon.FromHandle(iconHandle))
                using (Bitmap bitmap = new Bitmap(64, 64, PixelFormat.Format32bppArgb))
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.Clear(Color.Transparent);
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.DrawIcon(icon, new Rectangle(0, 0, 64, 64));
                    using (var stream = new MemoryStream())
                    {
                        bitmap.Save(stream, ImageFormat.Png);
                        if (stream.Length == 0 || stream.Length > 128000)
                        {
                            return null;
                        }
                        return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
                    }
                }
            }
            catch
            {
                return null;
            }
            finally
            {
                DestroyIcon(iconHandle);
            }
        }
    }

    static class WindowSelector
    {
        public static SelectedWindow SelectFrontmost(
            int parentProcessId,
            string excludedBundleId
        )
        {
            IntPtr foreground = NativeWindow.GetForegroundWindow();
            if (foreground == IntPtr.Zero)
            {
                throw new AppSnapFailure(
                    "no_frontmost_application",
                    "There is no frontmost application to capture."
                );
            }

            IntPtr hwnd = NativeWindow.GetAncestor(foreground, NativeWindow.GA_ROOT);
            if (hwnd == IntPtr.Zero)
            {
                hwnd = foreground;
            }

            uint pid;
            NativeWindow.GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0)
            {
                throw new AppSnapFailure(
                    "no_frontmost_application",
                    "There is no frontmost application to capture."
                );
            }

            if (
                pid == NativeWindow.CurrentProcessId
                || NativeWindow.IsInProcessTree(pid, parentProcessId)
            )
            {
                throw new AppSnapFailure(
                    "excluded_frontmost_application",
                    "Synara cannot capture its own window."
                );
            }

            string aumid = NativeWindow.AppUserModelId(hwnd);
            if (
                !string.IsNullOrEmpty(excludedBundleId)
                && string.Equals(aumid, excludedBundleId, StringComparison.OrdinalIgnoreCase)
            )
            {
                throw new AppSnapFailure(
                    "excluded_frontmost_application",
                    "Synara cannot capture its own window."
                );
            }

            if (
                !NativeWindow.IsWindowVisible(hwnd)
                || NativeWindow.IsCloaked(hwnd)
                || NativeWindow.IsToolOrNonActivating(hwnd)
            )
            {
                throw new AppSnapFailure(
                    "no_eligible_window",
                    "The frontmost application has no visible, shareable window."
                );
            }

            NativeWindow.RECT rect;
            if (!NativeWindow.GetWindowRect(hwnd, out rect))
            {
                throw new AppSnapFailure(
                    "invalid_window_dimensions",
                    "The selected window has invalid capture dimensions."
                );
            }

            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width < 2 || height < 2)
            {
                throw new AppSnapFailure(
                    "invalid_window_dimensions",
                    "The selected window has invalid capture dimensions."
                );
            }

            if ((long)width * height > 16000000)
            {
                throw new AppSnapFailure(
                    "invalid_window_dimensions",
                    "The selected window is too large to capture."
                );
            }

            if (NativeWindow.IsElevated(pid) && !NativeWindow.IsElevated((uint)NativeWindow.CurrentProcessId))
            {
                throw new AppSnapFailure(
                    "no_eligible_window",
                    "Synara cannot capture an elevated window."
                );
            }

            string imagePath = NativeWindow.ProcessImagePath(pid);
            string identifier = aumid ?? imagePath;
            return new SelectedWindow(
                hwnd,
                new Rectangle(rect.Left, rect.Top, width, height),
                NativeWindow.AppDisplayName(imagePath, pid),
                identifier,
                NativeWindow.AppIconDataUrl(imagePath),
                NativeWindow.WindowTitle(hwnd)
            );
        }
    }

    static class WindowPngCapture
    {
        const int MaximumPngByteCount = 10 * 1024 * 1024;
        const int MaximumCaptureDimension = 8192;
        const int CaptureTimeoutMilliseconds = 6000;

        public static byte[] Capture(SelectedWindow window)
        {
            Bitmap bitmap = CaptureBitmap(window.Handle, window.Bounds.Width, window.Bounds.Height);
            try
            {
                if (IsMostlyBlack(bitmap))
                {
                    throw new AppSnapFailure(
                        "capture_failed",
                        "The window captured as a blank image."
                    );
                }

                if (
                    bitmap.Width > MaximumCaptureDimension
                    || bitmap.Height > MaximumCaptureDimension
                )
                {
                    Bitmap scaled = ScaleToMaxDimension(bitmap, MaximumCaptureDimension);
                    bitmap.Dispose();
                    bitmap = scaled;
                }

                return EncodePngUnderLimit(bitmap);
            }
            finally
            {
                bitmap.Dispose();
            }
        }

        static Bitmap CaptureBitmap(IntPtr hwnd, int width, int height)
        {
            Bitmap result = null;
            Exception error = null;
            var thread = new Thread(() =>
            {
                try
                {
                    var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                    using (Graphics graphics = Graphics.FromImage(bitmap))
                    {
                        IntPtr hdc = graphics.GetHdc();
                        try
                        {
                            if (!NativeWindow.PrintWindow(hwnd, hdc, NativeWindow.PW_RENDERFULLCONTENT))
                            {
                                bitmap.Dispose();
                                error = new AppSnapFailure(
                                    "capture_failed",
                                    "Windows could not copy the window."
                                );
                                return;
                            }
                        }
                        finally
                        {
                            graphics.ReleaseHdc(hdc);
                        }
                    }
                    result = bitmap;
                }
                catch (Exception exception)
                {
                    error = exception;
                }
            });
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!thread.Join(CaptureTimeoutMilliseconds))
            {
                try
                {
                    thread.Abort();
                }
                catch
                {
                }
                throw new AppSnapFailure(
                    "capture_timed_out",
                    "Timed out while preparing or capturing the window."
                );
            }
            var failure = error as AppSnapFailure;
            if (failure != null)
            {
                throw failure;
            }
            if (error != null)
            {
                throw new AppSnapFailure("capture_failed", error.Message);
            }
            if (result == null)
            {
                throw new AppSnapFailure("capture_failed", "Windows could not copy the window.");
            }
            return result;
        }

        static bool IsMostlyBlack(Bitmap bitmap)
        {
            int samples = 0;
            int dark = 0;
            int stepX = Math.Max(1, bitmap.Width / 40);
            int stepY = Math.Max(1, bitmap.Height / 40);
            for (int y = 0; y < bitmap.Height; y += stepY)
            {
                for (int x = 0; x < bitmap.Width; x += stepX)
                {
                    Color color = bitmap.GetPixel(x, y);
                    samples += 1;
                    if (Math.Max(color.R, Math.Max(color.G, color.B)) < 8)
                    {
                        dark += 1;
                    }
                }
            }
            return samples > 0 && dark * 100 >= samples * 97;
        }

        static Bitmap ScaleToMaxDimension(Bitmap source, int maximum)
        {
            int largest = Math.Max(source.Width, source.Height);
            double scale = (double)maximum / largest;
            int width = Math.Max(1, (int)Math.Floor(source.Width * scale));
            int height = Math.Max(1, (int)Math.Floor(source.Height * scale));
            var scaled = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(scaled))
            {
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.DrawImage(source, 0, 0, width, height);
            }
            return scaled;
        }

        static byte[] EncodePngUnderLimit(Bitmap source)
        {
            Bitmap current = source;
            bool ownsCurrent = false;
            try
            {
                for (int attempt = 0; attempt < 20; attempt++)
                {
                    using (var stream = new MemoryStream())
                    {
                        current.Save(stream, ImageFormat.Png);
                        if (stream.Length < MaximumPngByteCount)
                        {
                            return stream.ToArray();
                        }

                        double byteRatio = (MaximumPngByteCount - 1d) / stream.Length;
                        double scale = Math.Min(0.82, Math.Max(0.25, Math.Sqrt(byteRatio) * 0.9));
                        int width = Math.Max(1, (int)Math.Floor(current.Width * scale));
                        int height = Math.Max(1, (int)Math.Floor(current.Height * scale));
                        if (width >= current.Width && height >= current.Height)
                        {
                            break;
                        }

                        var next = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                        using (Graphics graphics = Graphics.FromImage(next))
                        {
                            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            graphics.DrawImage(current, 0, 0, width, height);
                        }
                        if (ownsCurrent)
                        {
                            current.Dispose();
                        }
                        current = next;
                        ownsCurrent = true;
                    }
                }
            }
            finally
            {
                if (ownsCurrent)
                {
                    current.Dispose();
                }
            }

            throw new AppSnapFailure(
                "png_too_large",
                "The captured window could not be reduced below the 10 MiB image limit."
            );
        }
    }

    static class CaptureFiles
    {
        public static void PreparePrivateOutputDirectory(string directory)
        {
            try
            {
                Directory.CreateDirectory(directory);
            }
            catch (Exception exception)
            {
                throw new AppSnapFailure(
                    "output_directory_unavailable",
                    "Could not prepare the private capture directory: " + exception.Message
                );
            }
        }

        public static string WritePrivatePng(byte[] data, string id, string directory)
        {
            string name = "appsnap-" + id + ".png";
            string destination = Path.Combine(directory, name);
            string temporary = destination + ".tmp-" + Process.GetCurrentProcess().Id;
            try
            {
                File.WriteAllBytes(temporary, data);
                if (File.Exists(destination))
                {
                    File.Delete(destination);
                }
                File.Move(temporary, destination);
                return destination;
            }
            catch (Exception exception)
            {
                try
                {
                    if (File.Exists(temporary))
                    {
                        File.Delete(temporary);
                    }
                    if (File.Exists(destination))
                    {
                        File.Delete(destination);
                    }
                }
                catch
                {
                }
                throw new AppSnapFailure(
                    "output_write_failed",
                    "Could not write the captured PNG: " + exception.Message
                );
            }
        }
    }

    sealed class AppSnapCaptureCoordinator
    {
        readonly NDJSONEmitter emitter;
        readonly string outputDirectory;
        readonly string excludedBundleId;
        readonly int parentProcessId;
        readonly object gate = new object();
        bool captureInProgress;

        public AppSnapCaptureCoordinator(
            NDJSONEmitter emitter,
            string outputDirectory,
            string excludedBundleId,
            int parentProcessId
        )
        {
            this.emitter = emitter;
            this.outputDirectory = outputDirectory;
            this.excludedBundleId = excludedBundleId;
            this.parentProcessId = parentProcessId;
        }

        public void HandleGesture()
        {
            string id = Guid.NewGuid().ToString("D").ToLowerInvariant();
            string capturedAt = AppSnapTime.Now();
            SelectedWindow selected;
            try
            {
                selected = WindowSelector.SelectFrontmost(parentProcessId, excludedBundleId);
            }
            catch (AppSnapFailure failure)
            {
                lock (gate)
                {
                    if (captureInProgress)
                    {
                        emitter.EmitError(
                            new AppSnapFailure(
                                "capture_in_progress",
                                "A previous AppSnap capture is still in progress."
                            ),
                            capturedAt,
                            id
                        );
                        return;
                    }
                }
                emitter.EmitTriggered(id, capturedAt);
                emitter.EmitError(failure, capturedAt, id);
                return;
            }

            lock (gate)
            {
                if (captureInProgress)
                {
                    emitter.EmitError(
                        new AppSnapFailure(
                            "capture_in_progress",
                            "A previous AppSnap capture is still in progress."
                        ),
                        capturedAt,
                        id
                    );
                    return;
                }
                captureInProgress = true;
            }

            emitter.EmitTriggered(id, capturedAt);
            try
            {
                byte[] png = WindowPngCapture.Capture(selected);
                string path = CaptureFiles.WritePrivatePng(png, id, outputDirectory);
                emitter.EmitCaptured(
                    id,
                    capturedAt,
                    path,
                    Path.GetFileName(path),
                    selected.SourceAppName,
                    selected.SourceBundleIdentifier,
                    selected.SourceAppIconDataUrl,
                    selected.SourceWindowTitle
                );
            }
            catch (AppSnapFailure failure)
            {
                emitter.EmitError(failure, capturedAt, id);
            }
            catch (Exception exception)
            {
                emitter.EmitError(
                    new AppSnapFailure(
                        "capture_processing_failed",
                        "Could not process the captured window: " + exception.Message
                    ),
                    capturedAt,
                    id
                );
            }
            finally
            {
                lock (gate)
                {
                    captureInProgress = false;
                }
            }
        }
    }
}
