import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.graphics.Rect;
import android.os.IBinder;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;

/** Shell-identity capture backend. No Operator permissions or platform signing required. */
public final class CaptureHelper {
    private static Class<?> captureClass() throws ClassNotFoundException {
        try { return Class.forName("android.window.ScreenCaptureInternal"); }
        catch (ClassNotFoundException olderAndroid) { return Class.forName("android.window.ScreenCapture"); }
    }
    private final Class<?> captureType = captureClass();
    private final boolean modern = captureType.getName().endsWith("Internal");
    private final Class<?> builderType = Class.forName(captureType.getName() + "$CaptureArgs$Builder");
    private final Class<?> argsType = Class.forName(captureType.getName() + "$CaptureArgs");
    private final Class<?> listenerType = Class.forName(captureType.getName() + "$ScreenCaptureListener");
    private final Class<?> resultType = Class.forName(captureType.getName() + "$ScreenshotHardwareBuffer");
    private final Method protectedComposition = Class.forName("android.view.SurfaceControl")
        .getMethod("getProtectedContentSupport");
    private final Object manager = Class.forName("android.view.IWindowManager$Stub")
        .getMethod("asInterface", IBinder.class).invoke(null,
            Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "window"));
    private final Method capture = Class.forName("android.view.IWindowManager")
        .getMethod("captureDisplay", int.class, argsType, listenerType);
    private final Object displayManager = Class.forName("android.hardware.display.IDisplayManager$Stub")
        .getMethod("asInterface", IBinder.class).invoke(null,
            Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "display"));
    private final Method displayInfo = Class.forName("android.hardware.display.IDisplayManager")
        .getMethod("getDisplayInfo", int.class);
    private int sourceWidth, sourceHeight, sourceRotation;
    private String sourceUniqueId;
    private final String session;
    private static volatile long lastRequest = System.nanoTime();
    private long sequence;

    private CaptureHelper(String session) throws Exception {
        this.session = session;
        // Resolve the selected adapter, then the safety capability. A policy named
        // THROW_EXCEPTION is insufficient: Android's layer path can discard it.
        configureProtection(builderType.getConstructor().newInstance());
        builderType.getConstructor();
        builderType.getMethod("setSourceCrop", Rect.class);
        builderType.getMethod("setFrameScale", float.class, float.class);
        builderType.getMethod("setPixelFormat", int.class);
        if (modern) builderType.getMethod("setIncludeSystemOverlays", boolean.class);
        builderType.getMethod("build");
        captureType.getMethod("createSyncCaptureListener").getReturnType().getMethod("getBuffer");
        resultType.getMethod("getHardwareBuffer");
        resultType.getMethod("containsSecureLayers");
        resultType.getMethod("containsHdrLayers");
        resultType.getMethod("asBitmap");
        Class.forName("android.view.IWindowManager").getMethod("isKeyguardLocked");
        if (!supportsProtectedComposition()) throw new IncompatibleProtection();
    }

    private static final class IncompatibleProtection extends Exception {}

    static final class UnsafeCapture extends Exception {
        final String reason;
        UnsafeCapture(String reason) { super(reason); this.reason = reason; }
    }

    /** The callback is the first operation allowed to inspect pixel contents. */
    static <T> T readUnprotected(boolean compositionSupported, boolean secure, long usage,
            java.util.concurrent.Callable<T> readPixels) throws Exception {
        if (!compositionSupported) throw new UnsafeCapture("protected_composition");
        if (secure) throw new UnsafeCapture("secure_content");
        if ((usage & HardwareBuffer.USAGE_PROTECTED_CONTENT) != 0) {
            throw new UnsafeCapture("protected_content");
        }
        return readPixels.call();
    }

    private boolean supportsProtectedComposition() throws Exception {
        return Boolean.TRUE.equals(protectedComposition.invoke(null));
    }

    private void configureProtection(Object builder) throws Exception {
        if (modern) {
            Class<?> policies = Class.forName("android.window.ScreenCapture$ScreenCaptureParams");
            builderType.getMethod("setSecureContentPolicy", int.class).invoke(builder,
                policies.getField("SECURE_CONTENT_POLICY_REDACT").getInt(null));
            builderType.getMethod("setProtectedContentPolicy", int.class).invoke(builder,
                policies.getField("PROTECTED_CONTENT_POLICY_CAPTURE").getInt(null));
            // Use composition, not optional display readback, for the buffer-usage invariant.
            builderType.getMethod("setCaptureMode", int.class).invoke(builder, 0);
        } else {
            builderType.getMethod("setCaptureSecureLayers", boolean.class).invoke(builder, false);
            builderType.getMethod("setAllowProtected", boolean.class).invoke(builder, true);
        }
    }

    private static void reply(String json) {
        System.out.println(json);
        System.out.flush();
    }

    public static void main(String[] args) throws Exception {
        if (android.os.Process.myUid() != 2000 || args.length != 1
            || !args[0].matches("[a-f0-9-]{36}")) System.exit(2);
        String session = args[0];
        final java.io.File directory = new java.io.File("/data/local/tmp/androperator-capture-" + session);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            new java.io.File(directory, "capture.dex").delete();
            directory.delete();
        }));
        try { runSession(session); }
        finally {
            new java.io.File(directory, "capture.dex").delete();
            directory.delete();
        }
    }

    private static void runSession(String session) throws Exception {
        Thread watchdog = new Thread(() -> {
            while (true) {
                try { Thread.sleep(1000); } catch (InterruptedException ignored) { return; }
                if (System.nanoTime() - lastRequest > 60000000000L) System.exit(0);
            }
        });
        watchdog.setDaemon(true);
        watchdog.start();
        CaptureHelper helper;
        try {
            helper = new CaptureHelper(session);
        } catch (Throwable unavailable) {
            String missing = unavailable instanceof IncompatibleProtection ? "protected_composition"
                : unavailable instanceof ClassNotFoundException ? "capture_class"
                : unavailable instanceof NoSuchFieldException ? "capture_policy_constant"
                : unavailable instanceof NoSuchMethodException ? "capture_method" : "capture_initialization";
            String status = missing.equals("capture_initialization") ? "unavailable" : "incompatible";
            reply("{\"protocol\":1,\"session\":\"" + session + "\",\"status\":\"" + status + "\",\"missingCapability\":\""
                + missing + "\",\"androidApi\":" + android.os.Build.VERSION.SDK_INT + "}");
            return;
        }
        reply("{\"protocol\":1,\"session\":\"" + session + "\",\"status\":\"ready\"}");
        BufferedReader requests = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        String request;
        while ((request = requests.readLine()) != null) {
            lastRequest = System.nanoTime();
            if (!request.matches("[a-f0-9-]{36} (100|50|25)")) return;
            String[] fields = request.split(" ");
            try {
                helper.capture(fields[0], Integer.parseInt(fields[1]));
            } catch (Throwable unsafe) {
                // Never classify capture/policy/geometry uncertainty as compatibility failure.
                reply("{\"protocol\":1,\"session\":\"" + session
                    + "\",\"request\":\"" + fields[0] + "\",\"status\":\"capture_rejected\",\"reason\":\""
                    + (unsafe instanceof UnsafeCapture ? ((UnsafeCapture) unsafe).reason : "acquisition_uncertain") + "\"}");
                return;
            }
        }
    }

    private void readGeometry() throws Exception {
        Object info = displayInfo.invoke(displayManager, 0);
        if (info == null) throw new IllegalStateException("No primary display");
        sourceWidth = info.getClass().getField("logicalWidth").getInt(info);
        sourceHeight = info.getClass().getField("logicalHeight").getInt(info);
        sourceRotation = info.getClass().getField("rotation").getInt(info);
        sourceUniqueId = (String) info.getClass().getField("uniqueId").get(info);
        if (sourceWidth < 2 || sourceHeight < 2 || (long)sourceWidth * sourceHeight > 32000000
            || sourceRotation < 0 || sourceRotation > 3 || sourceUniqueId == null
            || !sourceUniqueId.matches("local:[0-9]+")) throw new IllegalStateException("Invalid primary geometry");
    }

    private void verifyDisplay() throws Exception {
        Object info = displayInfo.invoke(displayManager, 0);
        boolean locked = (boolean) Class.forName("android.view.IWindowManager")
            .getMethod("isKeyguardLocked").invoke(manager);
        if (info == null || locked || info.getClass().getField("state").getInt(info) != 2) {
            throw new IllegalStateException("Display is not interactive or is locked");
        }
        if (info.getClass().getField("logicalWidth").getInt(info) != sourceWidth
            || info.getClass().getField("logicalHeight").getInt(info) != sourceHeight
            || info.getClass().getField("rotation").getInt(info) != sourceRotation
            || !sourceUniqueId.equals(info.getClass().getField("uniqueId").get(info))) {
            throw new IllegalStateException("Display geometry changed; begin a new capture session");
        }
    }

    private void capture(String request, int percent) throws Exception {
        readGeometry();
        int width = Math.max(1, sourceWidth * percent / 100);
        int height = Math.max(1, sourceHeight * percent / 100);
        verifyDisplay();
        if (!supportsProtectedComposition()) throw new UnsafeCapture("protected_composition");
        Object builder = builderType.getConstructor().newInstance();
        builderType.getMethod("setSourceCrop", Rect.class).invoke(builder, new Rect(0, 0, sourceWidth, sourceHeight));
        builderType.getMethod("setFrameScale", float.class, float.class)
            .invoke(builder, (float) width / sourceWidth, (float) height / sourceHeight);
        builderType.getMethod("setPixelFormat", int.class).invoke(builder, 1);
        configureProtection(builder);
        if (modern) builderType.getMethod("setIncludeSystemOverlays", boolean.class).invoke(builder, true);
        Object listener = captureType.getMethod("createSyncCaptureListener").invoke(null);
        capture.invoke(manager, 0, builderType.getMethod("build").invoke(builder), listener);
        Object result = listener.getClass().getMethod("getBuffer").invoke(listener);
        if (result == null) throw new IllegalStateException("Display capture returned no buffer");
        HardwareBuffer buffer = (HardwareBuffer) resultType.getMethod("getHardwareBuffer").invoke(result);
        if (buffer == null) throw new IllegalStateException("Display capture returned a null hardware buffer");
        try {
            boolean secure = (boolean) resultType.getMethod("containsSecureLayers").invoke(result);
            // When protected composition is supported and requested, SurfaceFlinger
            // allocates a PROTECTED output if its captured snapshots contain protected
            // layers. Reject that output before asBitmap/copy/encoding, not by guessing
            // from black pixels or by a separate, racy window scan.
            byte[] png = readUnprotected(supportsProtectedComposition(), secure, buffer.getUsage(), () -> {
                if (buffer.getWidth() != width || buffer.getHeight() != height) {
                    throw new IllegalStateException("Returned hardware buffer dimensions mismatch");
                }
                Bitmap hardware = null, software = null;
                try {
                    hardware = (Bitmap) resultType.getMethod("asBitmap").invoke(result);
                    if (hardware == null) throw new IllegalStateException("Cannot wrap hardware buffer");
                    software = hardware.copy(Bitmap.Config.ARGB_8888, false);
                    if (software == null || software.getWidth() != width || software.getHeight() != height) {
                        throw new IllegalStateException("Readback geometry mismatch");
                    }
                    verifyDisplay();
                    java.io.ByteArrayOutputStream encoded = new java.io.ByteArrayOutputStream();
                    if (!software.compress(Bitmap.CompressFormat.PNG, 100, encoded)) {
                        throw new IllegalStateException("PNG encoding failed");
                    }
                    if (encoded.size() > 64 * 1024 * 1024) throw new IllegalStateException("PNG too large");
                    return encoded.toByteArray();
                } finally {
                    if (software != null) software.recycle();
                    if (hardware != null) hardware.recycle();
                }
            });
            verifyDisplay();
            if (!supportsProtectedComposition()) throw new UnsafeCapture("protected_composition");
            long captured = System.nanoTime();
            reply("{\"protocol\":1,\"session\":\"" + session
                + "\",\"request\":\"" + request + "\",\"status\":\"ok\",\"length\":" + png.length
                + ",\"sourceWidth\":" + sourceWidth + ",\"sourceHeight\":" + sourceHeight
                + ",\"physicalId\":\"" + sourceUniqueId.substring(6) + "\",\"rotation\":" + sourceRotation
                + ",\"scale\":" + percent + ",\"sequence\":" + (++sequence)
                + ",\"captureNanos\":\"" + captured + "\"}");
            System.out.write(png);
            System.out.flush();
        } finally {
            buffer.close();
        }
    }
}
