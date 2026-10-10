import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.graphics.Rect;
import android.os.IBinder;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;

/** Experimental shell-only access to Android's internal display capture API. */
public final class DirectCapture {
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
    private final int sourceWidth, sourceHeight, sourceRotation;
    private long sequence;

    private DirectCapture(int width, int height, int rotation) throws Exception {
        sourceWidth = width;
        sourceHeight = height;
        sourceRotation = rotation;
    }

    public static void main(String[] args) throws Exception {
        try {
            run(args);
        } catch (Exception error) {
            error.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static void run(String[] args) throws Exception {
        if (args.length != 5 || !args[0].equals("session") || !args[1].equals("0")) {
            throw new IllegalArgumentException("Expected session, logical display 0, source width, height and rotation");
        }
        int width = Integer.parseInt(args[2]), height = Integer.parseInt(args[3]);
        int rotation = Integer.parseInt(args[4]);
        if (width < 1 || height < 1 || (long) width * height > 32000000 || rotation < 0 || rotation > 3) {
            throw new IllegalArgumentException("Invalid source dimensions");
        }
        DirectCapture helper = new DirectCapture(width, height, rotation);
        BufferedReader requests = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        String request;
        while ((request = requests.readLine()) != null) {
            if (!request.matches("100|50|25")) throw new IllegalArgumentException("Invalid scale");
            helper.capture(Integer.parseInt(request));
        }
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
            || info.getClass().getField("rotation").getInt(info) != sourceRotation) {
            throw new IllegalStateException("Display geometry changed; begin a new capture session");
        }
    }

    private void capture(int percent) throws Exception {
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
            if (!software.compress(Bitmap.CompressFormat.PNG, 100, System.out)) {
                throw new IllegalStateException("PNG encoding failed");
            }
            System.out.flush();
            long finished = System.nanoTime();
            System.out.println("SCALE_TIMING {\"sourceWidth\":" + sourceWidth + ",\"sourceHeight\":" + sourceHeight
                + ",\"width\":" + width + ",\"height\":" + height
                + ",\"bufferWidth\":" + buffer.getWidth() + ",\"bufferHeight\":" + buffer.getHeight()
                + ",\"rotation\":" + sourceRotation
                + ",\"sequence\":" + (++sequence) + ",\"containsHdrLayers\":" + hdr
                + ",\"deviceCaptureMs\":" + (captured - started) / 1000000.0
                + ",\"readbackMs\":" + (copied - captured) / 1000000.0
                + ",\"encodeAndWriteMs\":" + (finished - copied) / 1000000.0 + "}");
            System.out.flush();
        } finally {
            if (software != null) software.recycle();
            if (hardware != null) hardware.recycle();
            buffer.close();
        }
    }
}
