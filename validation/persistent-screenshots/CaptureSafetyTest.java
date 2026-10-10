import android.hardware.HardwareBuffer;

/** Runs the production readback boundary on the host, without Android pixel access. */
public final class CaptureSafetyTest {
    private static int reads;

    private static void rejected(boolean composition, boolean secure, long usage, String reason) throws Exception {
        reads = 0;
        try {
            CaptureHelper.readUnprotected(composition, secure, usage, () -> { reads++; return "pixels"; });
            throw new AssertionError("Unsafe buffer accepted: " + reason);
        } catch (CaptureHelper.UnsafeCapture expected) {
            if (!expected.reason.equals(reason)) throw new AssertionError("Wrong rejection: " + expected.reason);
        }
        if (reads != 0) throw new AssertionError("Read protected pixels before rejecting");
    }

    public static void main(String[] args) throws Exception {
        long ordinary = HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_CPU_READ_OFTEN;
        long protectedUsage = HardwareBuffer.USAGE_PROTECTED_CONTENT | HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE;
        rejected(false, false, ordinary, "protected_composition");
        rejected(false, false, protectedUsage, "protected_composition");
        rejected(true, true, ordinary, "secure_content");
        rejected(true, false, protectedUsage, "protected_content");
        // A malformed protected buffer carrying additional CPU flags is still rejected.
        rejected(true, false, protectedUsage | ordinary, "protected_content");
        reads = 0;
        String image = CaptureHelper.readUnprotected(true, false, ordinary, () -> { reads++; return "ordinary"; });
        if (!image.equals("ordinary") || reads != 1) throw new AssertionError("Ordinary readback changed");
        Exception failure = new Exception("readback failed");
        try {
            CaptureHelper.readUnprotected(true, false, ordinary, () -> { throw failure; });
            throw new AssertionError("Readback failure concealed");
        } catch (Exception expected) {
            if (expected != failure) throw new AssertionError("Readback failure replaced");
        }
        System.out.println("Capture safety boundary: 7 checks passed");
    }
}
