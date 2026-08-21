using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Synara.AppSnap
{
    sealed class AppSnapFailure : Exception
    {
        public readonly string Code;

        public AppSnapFailure(string code, string message)
            : base(message)
        {
            Code = code;
        }
    }

    enum AppSnapMode
    {
        CheckPermissions,
        RequestPermissions,
        Watch,
    }

    sealed class AppSnapOptions
    {
        public readonly AppSnapMode Mode;
        public readonly string OutputDirectory;
        public readonly string ExcludedBundleId;
        public readonly bool ExternalTrigger;

        AppSnapOptions(
            AppSnapMode mode,
            string outputDirectory,
            string excludedBundleId,
            bool externalTrigger
        )
        {
            Mode = mode;
            OutputDirectory = outputDirectory;
            ExcludedBundleId = excludedBundleId;
            ExternalTrigger = externalTrigger;
        }

        public static AppSnapOptions Parse(string[] arguments)
        {
            string requestedMode = null;
            string outputDirectory = null;
            string excludedBundleId = null;
            bool externalTrigger = false;

            for (int index = 0; index < arguments.Length; index++)
            {
                string argument = arguments[index];
                switch (argument)
                {
                    case "--check-permissions":
                    case "--request-permissions":
                    case "--watch":
                        if (requestedMode != null)
                        {
                            throw new AppSnapFailure(
                                "invalid_arguments",
                                "Choose exactly one helper mode."
                            );
                        }
                        requestedMode = argument;
                        break;
                    case "--output-dir":
                        index += 1;
                        if (index >= arguments.Length)
                        {
                            throw new AppSnapFailure(
                                "invalid_arguments",
                                "--output-dir requires a path."
                            );
                        }
                        outputDirectory = arguments[index];
                        break;
                    case "--excluded-bundle-id":
                        index += 1;
                        if (index >= arguments.Length)
                        {
                            throw new AppSnapFailure(
                                "invalid_arguments",
                                "--excluded-bundle-id requires a bundle identifier."
                            );
                        }
                        excludedBundleId = arguments[index];
                        break;
                    case "--external-trigger":
                        externalTrigger = true;
                        break;
                    default:
                        throw new AppSnapFailure(
                            "invalid_arguments",
                            "Unknown argument: " + argument
                        );
                }
            }

            switch (requestedMode)
            {
                case "--check-permissions":
                    RejectWatchArguments(outputDirectory, excludedBundleId, externalTrigger);
                    return new AppSnapOptions(AppSnapMode.CheckPermissions, null, null, false);
                case "--request-permissions":
                    RejectWatchArguments(outputDirectory, excludedBundleId, externalTrigger);
                    return new AppSnapOptions(AppSnapMode.RequestPermissions, null, null, false);
                case "--watch":
                    if (string.IsNullOrEmpty(outputDirectory))
                    {
                        throw new AppSnapFailure(
                            "invalid_arguments",
                            "--watch requires --output-dir."
                        );
                    }
                    if (string.IsNullOrEmpty(excludedBundleId))
                    {
                        throw new AppSnapFailure(
                            "invalid_arguments",
                            "--watch requires --excluded-bundle-id."
                        );
                    }
                    return new AppSnapOptions(
                        AppSnapMode.Watch,
                        Path.GetFullPath(outputDirectory),
                        excludedBundleId,
                        externalTrigger
                    );
                default:
                    throw new AppSnapFailure(
                        "invalid_arguments",
                        "Expected --check-permissions, --request-permissions, or --watch."
                    );
            }
        }

        static void RejectWatchArguments(
            string outputDirectory,
            string excludedBundleId,
            bool externalTrigger
        )
        {
            if (outputDirectory != null || excludedBundleId != null || externalTrigger)
            {
                throw new AppSnapFailure(
                    "invalid_arguments",
                    "Permission checks do not accept watch arguments."
                );
            }
        }
    }

    static class AppSnapTime
    {
        public static string Now()
        {
            return DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        }
    }

    static class JsonText
    {
        public static string String(string value)
        {
            if (value == null)
            {
                return "null";
            }

            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');
            foreach (char character in value)
            {
                switch (character)
                {
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        if (character < 0x20)
                        {
                            builder.Append("\\u");
                            builder.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(character);
                        }
                        break;
                }
            }
            builder.Append('"');
            return builder.ToString();
        }
    }

    static class Stdio
    {
        const int STD_INPUT_HANDLE = -10;
        const int STD_OUTPUT_HANDLE = -11;
        const int STD_ERROR_HANDLE = -12;

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr GetStdHandle(int nStdHandle);

        public static Stream OpenInput()
        {
            return Open(STD_INPUT_HANDLE, FileAccess.Read);
        }

        public static Stream OpenOutput()
        {
            return Open(STD_OUTPUT_HANDLE, FileAccess.Write);
        }

        public static Stream OpenError()
        {
            return Open(STD_ERROR_HANDLE, FileAccess.Write);
        }

        static Stream Open(int standardHandle, FileAccess access)
        {
            IntPtr handle = GetStdHandle(standardHandle);
            if (handle == IntPtr.Zero || handle == new IntPtr(-1))
            {
                return Stream.Null;
            }
            return new FileStream(new SafeFileHandle(handle, false), access, 4096, false);
        }
    }

    sealed class NDJSONEmitter
    {
        readonly object gate = new object();
        readonly Stream output;
        readonly Stream error;

        public NDJSONEmitter()
        {
            output = Stdio.OpenOutput();
            error = Stdio.OpenError();
        }

        public void EmitReady()
        {
            Emit("{\"type\":\"ready\"}");
        }

        public void EmitTriggered(string id, string capturedAt)
        {
            Emit(
                "{\"type\":\"triggered\",\"id\":"
                    + JsonText.String(id)
                    + ",\"capturedAt\":"
                    + JsonText.String(capturedAt)
                    + "}"
            );
        }

        public void EmitCaptured(
            string id,
            string capturedAt,
            string path,
            string name,
            string sourceAppName,
            string sourceBundleIdentifier,
            string sourceAppIconDataUrl,
            string sourceWindowTitle
        )
        {
            var builder = new StringBuilder();
            builder.Append("{\"type\":\"captured\",\"id\":");
            builder.Append(JsonText.String(id));
            builder.Append(",\"capturedAt\":");
            builder.Append(JsonText.String(capturedAt));
            builder.Append(",\"path\":");
            builder.Append(JsonText.String(path));
            builder.Append(",\"name\":");
            builder.Append(JsonText.String(name));
            AppendOptional(builder, "sourceAppName", sourceAppName);
            AppendOptional(builder, "sourceBundleIdentifier", sourceBundleIdentifier);
            AppendOptional(builder, "sourceAppIconDataUrl", sourceAppIconDataUrl);
            AppendOptional(builder, "sourceWindowTitle", sourceWindowTitle);
            builder.Append('}');
            Emit(builder.ToString());
        }

        public void EmitError(AppSnapFailure failure, string capturedAt, string id = null)
        {
            var builder = new StringBuilder();
            builder.Append("{\"type\":\"error\",\"code\":");
            builder.Append(JsonText.String(failure.Code));
            builder.Append(",\"message\":");
            builder.Append(JsonText.String(failure.Message));
            builder.Append(",\"capturedAt\":");
            builder.Append(JsonText.String(capturedAt ?? AppSnapTime.Now()));
            if (!string.IsNullOrEmpty(id))
            {
                builder.Append(",\"id\":");
                builder.Append(JsonText.String(id));
            }
            builder.Append('}');
            Emit(builder.ToString());
        }

        public void EmitPermissions(bool inputMonitoring, bool screenRecording)
        {
            Emit(
                "{\"type\":\"permissions\",\"inputMonitoring\":"
                    + JsonText.String(inputMonitoring ? "granted" : "denied")
                    + ",\"screenRecording\":"
                    + JsonText.String(screenRecording ? "granted" : "denied")
                    + "}"
            );
        }

        public void WriteDiagnostic(string message)
        {
            byte[] bytes = Encoding.UTF8.GetBytes("[synara-appsnap-helper] " + message + "\n");
            lock (gate)
            {
                error.Write(bytes, 0, bytes.Length);
                error.Flush();
            }
        }

        static void AppendOptional(StringBuilder builder, string key, string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return;
            }
            builder.Append(",\"");
            builder.Append(key);
            builder.Append("\":");
            builder.Append(JsonText.String(value));
        }

        void Emit(string payload)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(payload + "\n");
            lock (gate)
            {
                output.Write(bytes, 0, bytes.Length);
                output.Flush();
            }
        }
    }
}
