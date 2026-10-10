import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Comparator;

/** Read-only shell probe: separates OS interface availability from image acquisition. */
public final class CaptureApiProbe {
    public static void main(String[] args) throws Exception {
        System.out.println("uid=" + android.os.Process.myUid());
        System.out.println("api=" + android.os.Build.VERSION.SDK_INT);
        System.out.println("release=" + android.os.Build.VERSION.RELEASE);
        System.out.println("build=" + android.os.Build.ID);
        try {
            System.out.println("protectedComposition=" + Class.forName("android.view.SurfaceControl")
                .getMethod("getProtectedContentSupport").invoke(null));
        } catch (ReflectiveOperationException unavailable) {
            System.out.println("protectedComposition=unavailable");
        }
        for (String name : new String[] {"SDK_INT_FULL", "INCREMENTAL"}) {
            try {
                System.out.println(name + "=" + android.os.Build.VERSION.class.getField(name).get(null));
            } catch (NoSuchFieldException missing) {
                System.out.println(name + "=absent");
            }
        }
        for (String name : new String[] {
            "android.window.ScreenCapture",
            "android.window.ScreenCapture$CaptureArgs$Builder",
            "android.window.ScreenCaptureInternal",
            "android.window.ScreenCaptureInternal$CaptureArgs$Builder",
            "android.window.ScreenCapture$ScreenCaptureParams",
            "android.view.IWindowManager"
        }) {
            Class<?> type;
            try { type = Class.forName(name); }
            catch (ClassNotFoundException missing) {
                System.out.println(name + "=absent");
                continue;
            }
            System.out.println(name + "=present");
            Field[] fields = type.getFields();
            Arrays.sort(fields, Comparator.comparing(Field::getName));
            for (Field field : fields) {
                if (field.getName().endsWith("CONTENT_POLICY_THROW_EXCEPTION")) {
                    System.out.println("  " + field.getName() + "=" + field.get(null));
                }
            }
            Method[] methods = type.getMethods();
            Arrays.sort(methods, Comparator.comparing(Method::toString));
            for (Method method : methods) {
                if (Arrays.asList("setFrameScale", "setSecureContentPolicy", "setProtectedContentPolicy",
                    "setCaptureSecureLayers", "setAllowProtected", "captureDisplay").contains(method.getName())) {
                    System.out.println("  " + method);
                }
            }
        }
    }
}
