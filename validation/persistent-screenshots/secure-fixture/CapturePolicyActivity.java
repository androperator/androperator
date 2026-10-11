package com.androperator.capturefixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.SurfaceView;
import android.view.SurfaceHolder;
import android.opengl.EGL14;
import android.opengl.EGLDisplay;
import android.opengl.EGLContext;
import android.opengl.EGLSurface;
import android.opengl.EGLConfig;
import android.opengl.GLES20;

/** Local, first-party FLAG_SECURE fixture. Contains no real private content. */
public final class CapturePolicyActivity extends Activity {
    private volatile boolean stopRendering;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 100, 40, 40);
        layout.setBackgroundColor(0xffffffff);
        TextView label = new TextView(this);
        label.setText("CAPTURE POLICY FIXTURE");
        label.setTextSize(30);
        label.setTextColor(0xff000000);
        layout.addView(label);
        Button secure = new Button(this);
        secure.setText("Enable secure window");
        secure.setOnClickListener(view -> {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            label.setText("SECURE WINDOW ACTIVE");
        });
        layout.addView(secure);
        Button ordinary = new Button(this);
        ordinary.setText("Disable secure window");
        ordinary.setOnClickListener(view -> {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            label.setText("ORDINARY WINDOW RESTORED");
        });
        layout.addView(ordinary);
        Button protectedBuffer = new Button(this);
        protectedBuffer.setText("Show protected buffer");
        layout.addView(protectedBuffer);
        Button clearBuffer = new Button(this);
        clearBuffer.setText("Remove protected buffer");
        layout.addView(clearBuffer);
        SurfaceView surface = new SurfaceView(this);
        // Deliberately not FLAG_SECURE or SurfaceView.setSecure: test the buffer
        // protection bit independently of the secure-window result flag.
        protectedBuffer.setOnClickListener(view -> {
            if (surface.getParent() != null) return;
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            stopRendering = false;
            label.setText("STARTING PROTECTED BUFFER");
            layout.addView(surface, new LinearLayout.LayoutParams(600, 400));
        });
        clearBuffer.setOnClickListener(view -> {
            stopRendering = true;
            layout.removeView(surface);
            label.setText("PROTECTED BUFFER REMOVED");
        });
        surface.getHolder().addCallback(new SurfaceHolder.Callback() {
            public void surfaceCreated(SurfaceHolder holder) {
                new Thread(() -> renderProtected(holder, label), "ProtectedFixture").start();
            }
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}
            public void surfaceDestroyed(SurfaceHolder holder) { stopRendering = true; }
        });
        setContentView(layout);
    }

    @Override public void onDestroy() { stopRendering = true; super.onDestroy(); }

    private void renderProtected(SurfaceHolder holder, TextView label) {
        final int protectedContent = 0x32C0; // EGL_PROTECTED_CONTENT_EXT
        EGLDisplay display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        EGLContext context = EGL14.EGL_NO_CONTEXT;
        EGLSurface surface = EGL14.EGL_NO_SURFACE;
        try {
            int[] version = new int[2];
            if (!EGL14.eglInitialize(display, version, 0, version, 1)) throw new Exception("initialize");
            String extensions = EGL14.eglQueryString(display, EGL14.EGL_EXTENSIONS);
            if (extensions == null || !extensions.contains("EGL_EXT_protected_content")) {
                throw new Exception("protected EGL unavailable");
            }
            EGLConfig[] configs = new EGLConfig[1];
            int[] count = new int[1];
            int[] attributes = { EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_NONE };
            if (!EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) || count[0] == 0) {
                throw new Exception("config");
            }
            context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT,
                new int[] { EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, protectedContent, EGL14.EGL_TRUE, EGL14.EGL_NONE }, 0);
            surface = EGL14.eglCreateWindowSurface(display, configs[0], holder.getSurface(),
                new int[] { protectedContent, EGL14.EGL_TRUE, EGL14.EGL_NONE }, 0);
            if (context == EGL14.EGL_NO_CONTEXT || surface == EGL14.EGL_NO_SURFACE
                || !EGL14.eglMakeCurrent(display, surface, surface, context)) throw new Exception("protected surface/context");
            int[] protection = new int[1];
            if (!EGL14.eglQuerySurface(display, surface, protectedContent, protection, 0)
                || protection[0] != EGL14.EGL_TRUE) throw new Exception("surface protection not confirmed");
            boolean first = true;
            while (!stopRendering) {
                GLES20.glClearColor(0.1f, 0.8f, 0.3f, 1f);
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
                if (!EGL14.eglSwapBuffers(display, surface)) throw new Exception("swap");
                if (first) {
                    first = false;
                    runOnUiThread(() -> label.setText("PROTECTED BUFFER PRESENTED"));
                }
                Thread.sleep(50);
            }
        } catch (Exception failure) {
            String detail = failure.getMessage() + " EGL=" + Integer.toHexString(EGL14.eglGetError());
            if (!stopRendering) runOnUiThread(() -> label.setText("PROTECTED FIXTURE UNAVAILABLE: " + detail));
        } finally {
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface);
            if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context);
            EGL14.eglTerminate(display);
        }
    }
}
