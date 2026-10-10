package com.androperator.capturefixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Local, first-party FLAG_SECURE fixture. Contains no real private content. */
public final class CapturePolicyActivity extends Activity {
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
        setContentView(layout);
    }
}
