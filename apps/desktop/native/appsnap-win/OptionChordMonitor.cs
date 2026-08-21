using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Synara.AppSnap
{
    sealed class OptionChordMonitor : IDisposable
    {
        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x0100;
        const int WM_KEYUP = 0x0101;
        const int WM_SYSKEYDOWN = 0x0104;
        const int WM_SYSKEYUP = 0x0105;
        const int VK_LMENU = 0xA4;
        const int VK_RMENU = 0xA5;
        const int EventTapRetryIntervalMs = 5000;

        [StructLayout(LayoutKind.Sequential)]
        struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(
            int idHook,
            LowLevelKeyboardProc lpfn,
            IntPtr hMod,
            uint dwThreadId
        );

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr GetModuleHandle(string lpModuleName);

        readonly NDJSONEmitter emitter;
        readonly Action onChord;
        readonly Control marshal;
        readonly LowLevelKeyboardProc hookProc;
        readonly Timer retryTimer;
        IntPtr hook;
        bool leftAltDown;
        bool rightAltDown;
        bool chordLatched;
        bool emittedReady;
        string lastInstallErrorCode;

        public OptionChordMonitor(NDJSONEmitter emitter, Control marshal, Action onChord)
        {
            this.emitter = emitter;
            this.marshal = marshal;
            this.onChord = onChord;
            hookProc = HookCallback;
            retryTimer = new Timer { Interval = EventTapRetryIntervalMs };
            retryTimer.Tick += delegate
            {
                TryInstall();
            };
        }

        public void Start()
        {
            if (!TryInstall())
            {
                retryTimer.Start();
            }
        }

        public void Dispose()
        {
            retryTimer.Stop();
            retryTimer.Dispose();
            if (hook != IntPtr.Zero)
            {
                UnhookWindowsHookEx(hook);
                hook = IntPtr.Zero;
            }
        }

        bool TryInstall()
        {
            if (hook != IntPtr.Zero)
            {
                return true;
            }

            IntPtr module = GetModuleHandle(null);
            hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, module, 0);
            if (hook == IntPtr.Zero)
            {
                ReportInstallFailure(
                    new AppSnapFailure(
                        "event_tap_unavailable",
                        "Windows could not create the passive Alt-key listener."
                    )
                );
                return false;
            }

            lastInstallErrorCode = null;
            retryTimer.Stop();
            if (!emittedReady)
            {
                emittedReady = true;
                emitter.EmitReady();
            }
            return true;
        }

        void ReportInstallFailure(AppSnapFailure failure)
        {
            if (lastInstallErrorCode == failure.Code)
            {
                return;
            }
            lastInstallErrorCode = failure.Code;
            emitter.EmitError(failure, AppSnapTime.Now());
        }

        IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int message = wParam.ToInt32();
                var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if (info.vkCode == VK_LMENU || info.vkCode == VK_RMENU)
                {
                    bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                    bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
                    if (down || up)
                    {
                        if (info.vkCode == VK_LMENU)
                        {
                            leftAltDown = down;
                        }
                        else
                        {
                            rightAltDown = down;
                        }

                        bool bothDown = leftAltDown && rightAltDown;
                        if (bothDown && !chordLatched)
                        {
                            chordLatched = true;
                            Control target = marshal;
                            Action callback = onChord;
                            if (target != null && callback != null && target.IsHandleCreated)
                            {
                                target.BeginInvoke(callback);
                            }
                        }
                        else if (!bothDown)
                        {
                            chordLatched = false;
                        }
                    }
                }
            }
            return CallNextHookEx(hook, nCode, wParam, lParam);
        }
    }
}
