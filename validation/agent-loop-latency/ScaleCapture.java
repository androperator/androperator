import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import java.io.DataInputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;

/** Experimental shell-side capture, not a production Operator API. */
public final class ScaleCapture {
    public static void main(String[] args) throws Exception {
        if (args.length != 2 || !args[0].matches("100|50|25|session") || !args[1].matches("[0-9]+")) {
            throw new IllegalArgumentException("Expected scale percent and physical display ID");
        }
        if (args[0].equals("session")) {
            BufferedReader requests = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
            String request;
            while ((request = requests.readLine()) != null) {
                if (!request.matches("100|50|25")) throw new IllegalArgumentException("Invalid scale");
                capture(Integer.parseInt(request), args[1]);
            }
        } else {
            capture(Integer.parseInt(args[0]), args[1]);
        }
    }

    private static void capture(int percent, String display) throws Exception {
        long started = System.nanoTime();
        Process capture = new ProcessBuilder("/system/bin/screencap", "-d", display)
            .redirectError(ProcessBuilder.Redirect.INHERIT).start();
        Bitmap source;
        int width, height;
        try (DataInputStream input = new DataInputStream(capture.getInputStream())) {
            width = Integer.reverseBytes(input.readInt());
            height = Integer.reverseBytes(input.readInt());
            int format = Integer.reverseBytes(input.readInt());
            // API 26 screencap has a 12-byte header with no color-space field.
            // Other old versions are deliberately unsupported by this experiment.
            int api = android.os.Build.VERSION.SDK_INT;
            if (api != 26 && api < 36) throw new IllegalStateException("Unsupported raw screencap version");
            int color = api == 26 ? 1 : Integer.reverseBytes(input.readInt());
            if (width < 1 || height < 1 || (long) width * height > 32000000
                || (format != 1 && format != 2) || (color != 1 && color != 2)) {
                throw new IllegalStateException("Unsupported raw capture geometry, pixel format or color space");
            }
            byte[] pixels = new byte[width * height * 4];
            input.readFully(pixels);
            if (input.read() != -1 || capture.waitFor() != 0) {
                throw new IllegalStateException("Unexpected raw screenshot length or capture failure");
            }
            source = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888, format == 1,
                ColorSpace.get(color == 1 ? ColorSpace.Named.SRGB : ColorSpace.Named.DISPLAY_P3));
            source.copyPixelsFromBuffer(ByteBuffer.wrap(pixels));
        } finally {
            capture.destroy();
        }
        long captured = System.nanoTime();
        int outputWidth = Math.max(1, width * percent / 100);
        int outputHeight = Math.max(1, height * percent / 100);
        Bitmap output = percent == 100 ? source
            : Bitmap.createScaledBitmap(source, outputWidth, outputHeight, true);
        long scaled = System.nanoTime();
        if (!output.compress(Bitmap.CompressFormat.PNG, 100, System.out)) {
            throw new IllegalStateException("PNG encoding failed");
        }
        System.out.flush();
        long finished = System.nanoTime();
        System.out.println("SCALE_TIMING {\"sourceWidth\":" + width + ",\"sourceHeight\":" + height
            + ",\"width\":" + outputWidth + ",\"height\":" + outputHeight
            + ",\"rawCaptureAndBitmapMs\":" + (captured - started) / 1000000.0
            + ",\"scaleMs\":" + (scaled - captured) / 1000000.0
            + ",\"encodeAndWriteMs\":" + (finished - scaled) / 1000000.0 + "}");
        System.out.flush();
        if (output != source) output.recycle();
        source.recycle();
    }
}
