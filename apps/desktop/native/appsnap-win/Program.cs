using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Synara.AppSnap
{
    static class Program
    {
        const int EX_USAGE = 64;

        [STAThread]
        static int Main(string[] arguments)
        {
            var emitter = new NDJSONEmitter();
            try
            {
                AppSnapOptions options = AppSnapOptions.Parse(arguments);
                switch (options.Mode)
                {
                    case AppSnapMode.CheckPermissions:
                    case AppSnapMode.RequestPermissions:
                        emitter.EmitPermissions(true, true);
                        return 0;
                    case AppSnapMode.Watch:
                        RunWatch(emitter, options);
                        return 0;
                    default:
                        throw new AppSnapFailure(
                            "invalid_arguments",
                            "Expected --check-permissions, --request-permissions, or --watch."
                        );
                }
            }
            catch (AppSnapFailure failure)
            {
                emitter.EmitError(failure, AppSnapTime.Now());
                return EX_USAGE;
            }
            catch (Exception exception)
            {
                emitter.EmitError(
                    new AppSnapFailure("helper_failed", exception.Message),
                    AppSnapTime.Now()
                );
                return 1;
            }
        }

        static void RunWatch(NDJSONEmitter emitter, AppSnapOptions options)
        {
            CaptureFiles.PreparePrivateOutputDirectory(options.OutputDirectory);
            int parentProcessId = NativeWindow.ParentProcessId(NativeWindow.CurrentProcessId);
            if (parentProcessId <= 0)
            {
                Environment.Exit(0);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WatchContext(emitter, options, parentProcessId));
        }
    }

    sealed class WatchContext : ApplicationContext
    {
        readonly NDJSONEmitter emitter;
        readonly Control marshal;
        readonly OptionChordMonitor monitor;
        readonly System.Windows.Forms.Timer parentTimer;
        readonly int parentProcessId;
        readonly Thread stdinThread;

        public WatchContext(NDJSONEmitter emitter, AppSnapOptions options, int parentProcessId)
        {
            this.emitter = emitter;
            this.parentProcessId = parentProcessId;
            marshal = new Control();
            IntPtr unused = marshal.Handle;

            var coordinator = new AppSnapCaptureCoordinator(
                emitter,
                options.OutputDirectory,
                options.ExcludedBundleId,
                parentProcessId
            );

            parentTimer = new System.Windows.Forms.Timer { Interval = 500 };
            parentTimer.Tick += delegate
            {
                ExitIfParentStopped();
            };
            parentTimer.Start();
            ExitIfParentStopped();

            stdinThread = new Thread(() => ReadTriggers(coordinator.HandleGesture))
            {
                IsBackground = true,
            };
            stdinThread.Start();

            if (options.ExternalTrigger)
            {
                monitor = null;
                emitter.EmitReady();
            }
            else
            {
                monitor = new OptionChordMonitor(emitter, marshal, coordinator.HandleGesture);
                monitor.Start();
            }
        }

        void ReadTriggers(Action onTrigger)
        {
            try
            {
                using (var reader = new StreamReader(Stdio.OpenInput(), Encoding.UTF8, false, 1024, true))
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (line.Trim() != "trigger")
                        {
                            continue;
                        }
                        Control target = marshal;
                        if (target != null && target.IsHandleCreated)
                        {
                            target.BeginInvoke(onTrigger);
                        }
                    }
                }
            }
            catch
            {
            }
        }

        void ExitIfParentStopped()
        {
            if (parentProcessId <= 1)
            {
                ExitThread();
                return;
            }

            int currentParent = NativeWindow.ParentProcessId(NativeWindow.CurrentProcessId);
            if (currentParent != parentProcessId)
            {
                Environment.Exit(0);
            }

            try
            {
                System.Diagnostics.Process.GetProcessById(parentProcessId);
            }
            catch
            {
                Environment.Exit(0);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                parentTimer.Stop();
                parentTimer.Dispose();
                if (monitor != null)
                {
                    monitor.Dispose();
                }
                marshal.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
