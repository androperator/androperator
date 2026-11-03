package com.androperator.rotationfixture;

import android.app.Activity;
import android.os.Bundle;
import android.content.res.Configuration;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

public class RotationActivity extends Activity implements DisplayManager.DisplayListener {
    private int leftCount;
    private int rightCount;
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            leftCount = state.getInt("left");
            rightCount = state.getInt("right");
        }
        render();
        ((DisplayManager) getSystemService(DISPLAY_SERVICE)).registerDisplayListener(this, null);
    }

    @Override public void onDestroy() {
        ((DisplayManager) getSystemService(DISPLAY_SERVICE)).unregisterDisplayListener(this);
        super.onDestroy();
    }

    @Override public void onDisplayAdded(int id) {}
    @Override public void onDisplayRemoved(int id) {}
    @Override public void onDisplayChanged(int id) { updateStatus(); }

    @Override public void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("left", leftCount);
        state.putInt("right", rightCount);
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        updateStatus();
    }

    private void render() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        status = new TextView(this);
        status.setTextColor(Color.BLACK);
        status.setTextSize(20);
        status.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams center = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        root.addView(status, center);
        addButton(root, "LEFT_TARGET", Gravity.LEFT | Gravity.TOP, () -> leftCount++);
        addButton(root, "RIGHT_TARGET", Gravity.RIGHT | Gravity.TOP, () -> rightCount++);
        Button hidden = addButton(root, "HIDDEN_TARGET", Gravity.CENTER, () -> rightCount += 100);
        hidden.setVisibility(View.INVISIBLE);
        setContentView(root);
        updateStatus();
    }

    private Button addButton(FrameLayout root, String label, int gravity, Runnable increment) {
        Button button = new Button(this);
        button.setText(label);
        button.setContentDescription(label);
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(420, 180, gravity);
        layout.setMargins(96, 176, 96, 0);
        root.addView(button, layout);
        button.setOnClickListener(view -> { increment.run(); updateStatus(); });
        return button;
    }

    private void updateStatus() {
        status.setText("UP ↑ ROTATION=" + getWindowManager().getDefaultDisplay().getRotation()
            + " LEFT_COUNT=" + leftCount + " RIGHT_COUNT=" + rightCount);
    }
}
