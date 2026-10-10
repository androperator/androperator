import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.graphics.Rect;
import android.os.IBinder;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;

/** Shell-identity capture backend. No Operator permissions or platform signing required. */
public final class CaptureHelper {
    private final Class<?> captureType = Class.forName("android.window.ScreenCaptureInternal");
    private final Class<?> builderType = Class.forName("android.window.ScreenCaptureInternal$CaptureArgs$Builder");
    private final Class<?> argsType = Class.forName("android.window.ScreenCaptureInternal$CaptureArgs");
    private final Class<?> listenerType = Class.forName("android.window.ScreenCaptureInternal$ScreenCaptureListener");
    private final Class<?> resultType = Class.forName("android.window.ScreenCaptureInternal$ScreenshotHardwareBuffer");
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
        // Resolve strict policy support before advertising compatibility.
        Class<?> policies = Class.forName("android.window.ScreenCapture$ScreenCaptureParams");
        policies.getField("SECURE_CONTENT_POLICY_THROW_EXCEPTION");
        policies.getField("PROTECTED_CONTENT_POLICY_THROW_EXCEPTION");
        builderType.getMethod("setSecureContentPolicy", int.class);
        builderType.getMethod("setProtectedContentPolicy", int.class);
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
            String missing = unavailable instanceof ClassNotFoundException ? "capture_class"
                : unavailable instanceof NoSuchFieldException ? "strict_policy_constant"
                : unavailable instanceof NoSuchMethodException ? "capture_method" : "capture_initialization";
            reply("{\"protocol\":1,\"session\":\"" + session + "\",\"status\":\"incompatible\",\"missingCapability\":\""
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
                    + "\",\"request\":\"" + fields[0] + "\",\"status\":\"capture_rejected\"}");
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
        long started = System.nanoTime();
        verifyDisplay();
        Object builder = builderType.getConstructor().newInstance();
        builderType.getMethod("setSourceCrop", Rect.class).invoke(builder, new Rect(0, 0, sourceWidth, sourceHeight));
        builderType.getMethod("setFrameScale", float.class, float.class)
            .invoke(builder, (float) width / sourceWidth, (float) height / sourceHeight);
        builderType.getMethod("setPixelFormat", int.class).invoke(builder, 1);
        Class<?> policies = Class.forName("android.window.ScreenCapture$ScreenCaptureParams");
        builderType.getMethod("setSecureContentPolicy", int.class).invoke(builder,
            policies.getField("SECURE_CONTENT_POLICY_THROW_EXCEPTION").getInt(null));
        builderType.getMethod("setProtectedContentPolicy", int.class).invoke(builder,
            policies.getField("PROTECTED_CONTENT_POLICY_THROW_EXCEPTION").getInt(null));
        builderType.getMethod("setIncludeSystemOverlays", boolean.class).invoke(builder, true);
        Object listener = captureType.getMethod("createSyncCaptureListener").invoke(null);
        capture.invoke(manager, 0, builderType.getMethod("build").invoke(builder), listener);
        Object result = listener.getClass().getMethod("getBuffer").invoke(listener);
        if (result == null) throw new IllegalStateException("Display capture returned no buffer");
        HardwareBuffer buffer = (HardwareBuffer) resultType.getMethod("getHardwareBuffer").invoke(result);
        if (buffer == null) throw new IllegalStateException("Display capture returned a null hardware buffer");
        Bitmap hardware = null, software = null;
        try {
            boolean secure = (boolean) resultType.getMethod("containsSecureLayers").invoke(result);
            boolean hdr = (boolean) resultType.getMethod("containsHdrLayers").invoke(result);
            if (secure) throw new IllegalStateException("Secure capture cannot be published");
            if (buffer.getWidth() != width || buffer.getHeight() != height) {
                throw new IllegalStateException("Returned hardware buffer does not match requested dimensions");
            }
            long captured = System.nanoTime();
            hardware = (Bitmap) resultType.getMethod("asBitmap").invoke(result);
            if (hardware == null) throw new IllegalStateException("Cannot wrap hardware buffer");
            software = hardware.copy(Bitmap.Config.ARGB_8888, false);
            if (software == null || software.getWidth() != width || software.getHeight() != height) {
                throw new IllegalStateException("Readback geometry mismatch");
            }
            verifyDisplay();
            long copied = System.nanoTime();
            java.io.ByteArrayOutputStream png = new java.io.ByteArrayOutputStream();
            if (!software.compress(Bitmap.CompressFormat.PNG, 100, png)) {
                throw new IllegalStateException("PNG encoding failed");
            }
            verifyDisplay();
            if (png.size() > 64 * 1024 * 1024) throw new IllegalStateException("PNG too large");
            reply("{\"protocol\":1,\"session\":\"" + session
                + "\",\"request\":\"" + request + "\",\"status\":\"ok\",\"length\":" + png.size()
                + ",\"sourceWidth\":" + sourceWidth + ",\"sourceHeight\":" + sourceHeight
                + ",\"physicalId\":\"" + sourceUniqueId.substring(6) + "\",\"rotation\":" + sourceRotation
                + ",\"scale\":" + percent + ",\"sequence\":" + (++sequence)
                + ",\"captureNanos\":\"" + captured + "\"}");
            png.writeTo(System.out);
            System.out.flush();
        } finally {
            if (software != null) software.recycle();
            if (hardware != null) hardware.recycle();
            buffer.close();
        }
    }
}
