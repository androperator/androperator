import android.hardware.HardwareBuffer;

/** Runs the production readback boundary on the host, without Android pixel access. */
public final class CaptureSafetyTest {
    private static int reads;

    private static void rejected(boolean secure, long usage, String reason) throws Exception {
        reads = 0;
        try {
            CaptureHelper.readUnprotected(secure, usage, () -> { reads++; return "pixels"; });
            throw new AssertionError("Unsafe buffer accepted: " + reason);
        } catch (CaptureHelper.UnsafeCapture expected) {
            if (!expected.reason.equals(reason)) throw new AssertionError("Wrong rejection: " + expected.reason);
        }
        if (reads != 0) throw new AssertionError("Read protected pixels before rejecting");
    }

    public static void main(String[] args) throws Exception {
        long ordinary = HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_CPU_READ_OFTEN;
        long protectedUsage = HardwareBuffer.USAGE_PROTECTED_CONTENT | HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE;
        rejected(true, ordinary, "secure_content");
        rejected(false, protectedUsage, "protected_content");
        // A malformed protected buffer carrying additional CPU flags is still rejected.
        rejected(false, protectedUsage | ordinary, "protected_content");
        reads = 0;
        String image = CaptureHelper.readUnprotected(false, ordinary, () -> { reads++; return "ordinary"; });
        if (!image.equals("ordinary") || reads != 1) throw new AssertionError("Ordinary readback changed");
        Exception failure = new Exception("readback failed");
        try {
            CaptureHelper.readUnprotected(false, ordinary, () -> { throw failure; });
            throw new AssertionError("Readback failure concealed");
        } catch (Exception expected) {
            if (expected != failure) throw new AssertionError("Readback failure replaced");
        }
        System.out.println("Capture safety boundary: 5 checks passed");
    }
}
