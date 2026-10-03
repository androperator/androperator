package androperator.operator.debug;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;

/** Shell-only, debug-only fixture. Actual MediaPlayer progress is independent of its session report. */
public class MediaProofActivity extends Activity {
    static MediaSession session;
    static MediaSession second;
    static MediaPlayer player;
    static boolean publish = true;
    static String commandMode = "normal";
    static float speed = 1f;
    static int notificationRevision = 0;
    static int playCommands = 0;
    static int pauseCommands = 0;
    static int seekCommands = 0;
    static int buttonCommands = 0;
    static android.app.PendingIntent lastButton;
    static Context app;
    static final Handler handler = new Handler(android.os.Looper.getMainLooper());
    static long samples = 0;
    static long screenOnEvents = 0;
    static long screenOffEvents = 0;
    static void report() {
        if (player == null) return;
        if (publish) session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_SEEK_TO)
            .setState(player.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                player.getCurrentPosition(), speed, SystemClock.elapsedRealtime()).build());
        try {
            JSONObject data = new JSONObject().put("actualPositionMs", player.getCurrentPosition())
                .put("actualPlaying", player.isPlaying()).put("sampleCount", ++samples)
                .put("playCommands", playCommands).put("pauseCommands", pauseCommands)
                .put("seekCommands", seekCommands).put("buttonCommands", buttonCommands)
                .put("notificationRevision", notificationRevision)
                .put("userUnlocked", Build.VERSION.SDK_INT < 24 || ((android.os.UserManager) app.getSystemService(Context.USER_SERVICE)).isUserUnlocked())
                .put("observedElapsedMs", SystemClock.elapsedRealtime())
                .put("screenOn", ((android.os.PowerManager) app.getSystemService(Context.POWER_SERVICE)).isInteractive())
                .put("deviceLocked", ((android.app.KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked())
                .put("screenOnEvents", screenOnEvents).put("screenOffEvents", screenOffEvents);
            try (FileOutputStream out = app.openFileOutput("media-proof.next", Context.MODE_PRIVATE)) {
                out.write(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            if (!new File(app.getFilesDir(), "media-proof.next").renameTo(new File(app.getFilesDir(), "media-proof.json"))) throw new IllegalStateException("Could not publish fixture sample");
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        app = getApplicationContext();
        TextView text = new TextView(this);
        text.setText("Androperator media proof: controlled real MediaPlayer progress");
        setContentView(text);
        if (player != null) return;
        android.content.IntentFilter powerFilter = new android.content.IntentFilter(Intent.ACTION_SCREEN_ON);
        powerFilter.addAction(Intent.ACTION_SCREEN_OFF);
        app.registerReceiver(new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) screenOnEvents++;
                if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) screenOffEvents++;
            }
        }, powerFilter);
        try {
            player = new MediaPlayer();
            player.setDataSource(new File(getFilesDir(), "media-proof.mp4").getPath());
            player.prepare();
            player.setLooping(true);
            player.setVolume(0, 0);
            player.setOnErrorListener((mp, what, extra) -> { android.util.Log.e("MediaProof", "player_error what=" + what + " extra=" + extra); return true; });
            session = new MediaSession(this, "notification-media-proof");
            session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { playCommands++; player.start(); report(); }
                @Override public void onPause() {
                    pauseCommands++;
                    if ("ignore".equals(commandMode)) return;
                    if ("replace".equals(commandMode)) { replaceSession(); return; }
                    player.pause(); report();
                }
                @Override public void onSeekTo(long position) {
                    seekCommands++;
                    if ("ignore".equals(commandMode)) return;
                    if ("replace-seek".equals(commandMode)) { replaceSession(); return; }
                    if (Build.VERSION.SDK_INT >= 26) player.seekTo(position, MediaPlayer.SEEK_CLOSEST);
                    else player.seekTo((int) position);
                    report();
                }
            });
            session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Controlled video fixture")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, player.getDuration()).build());
            session.setActive(true);
            player.start();
            handler.post(new Runnable() {
                public void run() { report(); handler.postDelayed(this, 100); }
            });
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("media-proof", "Media proof", NotificationManager.IMPORTANCE_LOW));
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "media-proof") : new Notification.Builder(this);
            manager.notify(8123, builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Controlled media proof")
                .setContentText("An ongoing notification visible to service reads").setOngoing(true).build());
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    static void postNotification(int id, String text, boolean summary) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(app, "media-proof") : new Notification.Builder(app);
        int mutability = "input".equals(text) ? (Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0) : android.app.PendingIntent.FLAG_IMMUTABLE;
        android.app.PendingIntent button = android.app.PendingIntent.getBroadcast(app, id,
            new Intent(app, Control.class).putExtra("operation", "button"), mutability | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        lastButton = button;
        Notification.Action.Builder action = new Notification.Action.Builder(android.R.drawable.ic_media_play, "Fixture button", button);
        if ("input".equals(text)) action.addRemoteInput(new android.app.RemoteInput.Builder("reply").setLabel("Reply").build());
        if ("authentication".equals(text) && Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true);
        ((NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id,
            builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Fixture revision " + (++notificationRevision))
                .setContentText(text).setGroup("fixture-group").setGroupSummary(summary).setProgress(100, 42, false)
                .addAction(action.build()).build());
    }
    static void replaceSession() {
        session.release();
        session = new MediaSession(app, "replacement-proof");
        session.setActive(true);
        report();
    }
    public static class Control extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            if (player == null) return;
            String operation = intent.getStringExtra("operation");
            if ("button".equals(operation)) { buttonCommands++; }
            else if ("input".equals(operation) || "authentication".equals(operation)) { postNotification(8124, operation, false); }
            else if ("cancel-button".equals(operation)) { if (lastButton != null) lastButton.cancel(); }
            else if ("replace-on-seek".equals(operation)) { commandMode = "replace-seek"; }
            else if ("duration-unknown".equals(operation)) { session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Unknown duration").build()); }
            else if ("duration-zero".equals(operation)) { session.setMetadata(new MediaMetadata.Builder().putLong(MediaMetadata.METADATA_KEY_DURATION, 0).build()); }
            else if ("duration-normal".equals(operation)) { session.setMetadata(new MediaMetadata.Builder().putLong(MediaMetadata.METADATA_KEY_DURATION, player.getDuration()).build()); }
            else if ("post".equals(operation) || "update".equals(operation)) { postNotification(8124, operation, false); }
            else if ("group".equals(operation)) { postNotification(8125, "summary", true); }
            else if ("remove".equals(operation)) { ((NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(8124); }
            else if ("many".equals(operation)) {
                char[] chars = new char[1024]; java.util.Arrays.fill(chars, 'x');
                for (int id = 8200; id < 8240; id++) postNotification(id, new String(chars), false);
            }
            else if ("clear".equals(operation)) { ((NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).cancelAll(); }
            else if ("speed-two".equals(operation) && Build.VERSION.SDK_INT >= 23) { speed = 2f; player.setPlaybackParams(new android.media.PlaybackParams().setSpeed(speed)); publish = true; }
            else if ("buffering".equals(operation)) { player.pause(); publish = false; session.setPlaybackState(new PlaybackState.Builder().setState(PlaybackState.STATE_BUFFERING, player.getCurrentPosition(), 1f, SystemClock.elapsedRealtime()).build()); }
            else if ("unknown".equals(operation)) { publish = false; session.setPlaybackState(new PlaybackState.Builder().setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f, 0).build()); }
            else if ("ignore".equals(operation) || "normal".equals(operation) || "replace-on-pause".equals(operation)) {
                commandMode = "replace-on-pause".equals(operation) ? "replace" : operation;
            }
            else if ("inactive".equals(operation)) { session.setActive(false); }
            else if ("reactivate".equals(operation)) { session.setActive(true); }
            else if ("remove-second".equals(operation)) { if (second != null) second.release(); second = null; }
            else if ("stall".equals(operation)) { report(); publish = false; player.pause(); }
            else if ("unpublished-play".equals(operation)) { publish = false; player.start(); }
            else if ("resume".equals(operation)) { publish = true; player.start(); }
            else if ("second".equals(operation)) {
                second = new MediaSession(context, "second-proof"); second.setActive(true);
            } else if ("replace".equals(operation)) {
                replaceSession();
            }
            report();
        }
    }
}
