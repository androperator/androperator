package com.androperator.scrollfixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.view.View;

/** Synthetic long list with an independently observable scroll position and click count. */
public final class ScrollTerminationActivity extends Activity {
    private int clicks;
    private TextView status;
    private ScrollView scroll;
    private LinearLayout rows;
    private int rowCount;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        status = new TextView(this);
        status.setContentDescription("RESULT_COUNTER");
        root.addView(status, new LinearLayout.LayoutParams(-1, 150));
        LinearLayout controls = new LinearLayout(this);
        addControl(controls, "LONG_LIST", () -> populate(30));
        addControl(controls, "SHORT_LIST", () -> populate(2));
        addControl(controls, "JUMP_TO_END", () -> scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN)));
        root.addView(controls, new LinearLayout.LayoutParams(-1, 180));
        scroll = new ScrollView(this);
        scroll.setContentDescription("SCROLL_CONTAINER");
        rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(rows);
        scroll.setOnScrollChangeListener((view, x, y, oldX, oldY) -> update());
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        populate(30);
    }

    private void addControl(LinearLayout parent, String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setContentDescription(label);
        button.setOnClickListener(view -> action.run());
        parent.addView(button, new LinearLayout.LayoutParams(0, -1, 1));
    }

    private void populate(int count) {
        rows.removeAllViews();
        rowCount = count;
        clicks = 0;
        for (int index = 0; index < count; index++) {
            TextView row = new TextView(this);
            row.setText("ROW_" + index);
            rows.addView(row, new LinearLayout.LayoutParams(-1, 1600));
        }
        Button target = new Button(this);
        target.setContentDescription("BUDGET_TARGET");
        target.setText("BUDGET_TARGET");
        target.setOnClickListener(view -> { clicks++; update(); });
        rows.addView(target, new LinearLayout.LayoutParams(-1, 200));
        scroll.scrollTo(0, 0);
        update();
    }

    private void update() {
        status.setText("CLICK_COUNT=" + clicks + " SCROLL_Y=" + scroll.getScrollY() + " ROWS=" + rowCount);
    }
}
