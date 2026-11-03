package com.androperator.landscapefixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;

/** No accounts, network access, preferences, or external app content. */
public final class LandscapeTargetActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        setContentView(root);
        addTarget(root, "LEFT_TARGET", Gravity.LEFT | Gravity.CENTER_VERTICAL, 0);
        addTarget(root, "RIGHT_TARGET", Gravity.RIGHT | Gravity.CENTER_VERTICAL, 0);
        addTarget(root, "HIDDEN_TARGET", Gravity.CENTER, View.INVISIBLE);
        addTarget(root, "AMBIGUOUS_TARGET", Gravity.CENTER_HORIZONTAL | Gravity.TOP, 0);
        addTarget(root, "AMBIGUOUS_TARGET", Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM, 0);
        Button outside = addTarget(root, "OFFSCREEN_TARGET", Gravity.LEFT | Gravity.TOP, 0);
        outside.setTranslationX(10000);
    }

    private Button addTarget(FrameLayout root, String label, int gravity, int visibility) {
        Button button = new Button(this);
        button.setContentDescription(label);
        button.setText(label + "=0");
        button.setVisibility(visibility);
        int[] count = {0};
        button.setOnClickListener(view -> button.setText(label + "=" + (++count[0])));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(300, 180, gravity);
        params.setMargins(48, 48, 48, 48);
        root.addView(button, params);
        return button;
    }
}
