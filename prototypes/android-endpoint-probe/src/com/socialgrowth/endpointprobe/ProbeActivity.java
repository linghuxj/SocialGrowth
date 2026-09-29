package com.socialgrowth.endpointprobe;

import android.app.Activity;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.TextView;
import android.widget.Button;
import android.widget.LinearLayout;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Bounded foreground feasibility probe. No shell, network reporting, pairing or business actions. */
public final class ProbeActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Candidate> candidates = new HashMap<>();
    private final List<NsdManager.DiscoveryListener> discoveries = new ArrayList<>();
    private final List<NsdManager.ServiceInfoCallback> resolutions = new ArrayList<>();
    private final List<String> errors = new ArrayList<>();
    private final String scanId = UUID.randomUUID().toString();
    private final long startedAt = System.currentTimeMillis();
    private final long startedElapsed = SystemClock.elapsedRealtime();
    private NsdManager nsd;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private Network wifi;
    private Set<InetAddress> localAddresses = new HashSet<>();
    private boolean finished;
    private TextView status;
    private int wifiCount;

    private static final class Candidate {
        String kind;
        String state = "resolving";
        int port;
        int addressCount;
        boolean localMatch;
        long observedAt;
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        status = new TextView(this);
        status.setTextSize(20);
        status.setPadding(32, 80, 32, 32);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.addView(status);
        Button retry = new Button(this);
        retry.setText("重新检查");
        retry.setOnClickListener(view -> recreate());
        layout.addView(retry);
        setContentView(layout);
        nsd = getSystemService(NsdManager.class);
        connectivity = getSystemService(ConnectivityManager.class);
        status.setText("正在检查本机调试端口…\n约 20 秒后结束。\n请保持此页面在前台。\n\n这是诊断工具，不代表设备已接入业务。");
        try {
            for (Network network : connectivity.getAllNetworks()) {
                NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                        && !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                    wifi = network;
                    wifiCount++;
                }
            }
            if (wifiCount != 1) { finishProbe("wifi_selection_blocked"); return; }
            localAddresses = addresses(connectivity.getLinkProperties(wifi));
            if (localAddresses.isEmpty()) { finishProbe("wifi_addresses_unknown"); return; }
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override public void onLost(Network network) {
                    if (network.equals(wifi)) finishProbe("network_lost");
                }
                @Override public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
                    if (network.equals(wifi) && !localAddresses.equals(addresses(properties))) {
                        finishProbe("network_changed");
                    }
                }
            };
            connectivity.registerNetworkCallback(new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), networkCallback, handler);
            discover("_adb-tls-connect._tcp.", "connect");
            discover("_adb-tls-pairing._tcp.", "pairing");
            handler.postDelayed(() -> finishProbe("window_complete"), 20_000);
        } catch (RuntimeException error) {
            errors.add("setup:" + error.getClass().getSimpleName());
            finishProbe("setup_failed");
        }
    }

    private Set<InetAddress> addresses(LinkProperties properties) {
        Set<InetAddress> result = new HashSet<>();
        if (properties != null) {
            for (LinkAddress link : properties.getLinkAddresses()) result.add(link.getAddress());
        }
        return result;
    }

    private String key(NsdServiceInfo service, String kind) {
        // Service names may contain identifiers; only keep them in process memory.
        return kind + ":" + service.getServiceName();
    }

    private void discover(String type, String kind) {
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String ignored) { }
            @Override public void onDiscoveryStopped(String ignored) { }
            @Override public void onStartDiscoveryFailed(String ignored, int code) {
                if (!finished) errors.add(kind + ":discovery_failed:" + code);
            }
            @Override public void onStopDiscoveryFailed(String ignored, int code) {
                errors.add(kind + ":stop_failed:" + code);
            }
            @Override public void onServiceFound(NsdServiceInfo service) {
                if (finished) return;
                String id = key(service, kind);
                if (candidates.containsKey(id)) return;
                Candidate candidate = new Candidate();
                candidate.kind = kind;
                candidates.put(id, candidate);
                NsdManager.ServiceInfoCallback callback = new NsdManager.ServiceInfoCallback() {
                    @Override public void onServiceInfoCallbackRegistrationFailed(int code) {
                        if (finished) return;
                        candidate.state = "resolution_failed";
                        errors.add(kind + ":resolution_failed:" + code);
                    }
                    @Override public void onServiceUpdated(NsdServiceInfo info) {
                        if (finished) return;
                        candidate.port = info.getPort();
                        candidate.addressCount = info.getHostAddresses().size();
                        candidate.localMatch = wifi.equals(info.getNetwork())
                                && info.getHostAddresses().stream().anyMatch(localAddresses::contains);
                        candidate.state = "observed";
                        candidate.observedAt = System.currentTimeMillis();
                    }
                    @Override public void onServiceLost() {
                        if (!finished) { candidate.state = "lost"; candidate.localMatch = false; }
                    }
                    @Override public void onServiceInfoCallbackUnregistered() { }
                };
                resolutions.add(callback);
                try {
                    nsd.registerServiceInfoCallback(service, getMainExecutor(), callback);
                } catch (RuntimeException error) {
                    candidate.state = "resolution_failed";
                    errors.add(kind + ":register:" + error.getClass().getSimpleName());
                }
            }
            @Override public void onServiceLost(NsdServiceInfo service) {
                Candidate candidate = candidates.get(key(service, kind));
                if (!finished && candidate != null) {
                    candidate.state = "lost";
                    candidate.localMatch = false;
                }
            }
        };
        discoveries.add(listener);
        nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, wifi, getMainExecutor(), listener);
    }

    private JSONObject endpoint(String kind, String reason) throws JSONException {
        List<Candidate> local = new ArrayList<>();
        for (Candidate candidate : candidates.values()) {
            if (kind.equals(candidate.kind) && candidate.localMatch && "observed".equals(candidate.state)
                    && candidate.port > 0 && candidate.port <= 65535) local.add(candidate);
        }
        JSONObject result = new JSONObject();
        boolean usable = "window_complete".equals(reason) && errors.isEmpty() && local.size() == 1;
        result.put("state", usable ? "candidate" : local.size() > 1 ? "ambiguous" : "unknown");
        result.put("localCandidateCount", local.size());
        result.put("port", usable ? local.get(0).port : JSONObject.NULL);
        result.put("observedAt", usable ? local.get(0).observedAt : JSONObject.NULL);
        return result;
    }

    private void finishProbe(String reason) {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        for (NsdManager.DiscoveryListener listener : discoveries) {
            try { nsd.stopServiceDiscovery(listener); }
            catch (RuntimeException error) { errors.add("stop:" + error.getClass().getSimpleName()); }
        }
        for (NsdManager.ServiceInfoCallback callback : resolutions) {
            try { nsd.unregisterServiceInfoCallback(callback); }
            catch (RuntimeException error) { errors.add("unregister:" + error.getClass().getSimpleName()); }
        }
        if (networkCallback != null) {
            try { connectivity.unregisterNetworkCallback(networkCallback); }
            catch (RuntimeException error) { errors.add("network_cleanup:" + error.getClass().getSimpleName()); }
        }
        try {
            JSONArray observations = new JSONArray();
            for (Candidate candidate : candidates.values()) {
                observations.put(new JSONObject().put("kind", candidate.kind).put("state", candidate.state)
                        .put("port", candidate.port).put("localAddressMatch", candidate.localMatch)
                        .put("resolvedAddressCount", candidate.addressCount).put("observedAt", candidate.observedAt));
            }
            JSONObject report = new JSONObject().put("schemaVersion", 1).put("scanId", scanId)
                    .put("startedAt", startedAt).put("finishedAt", System.currentTimeMillis())
                    .put("durationMs", SystemClock.elapsedRealtime() - startedElapsed).put("reason", reason)
                    .put("wifiNetworkCount", wifiCount).put("localWifiAddressCount", localAddresses.size())
                    .put("observations", observations).put("errors", new JSONArray(errors))
                    .put("connect", endpoint("connect", reason)).put("pairing", endpoint("pairing", reason))
                    .put("scope", "foreground NSD observation only; candidate is not trusted device identity or a live endpoint lease");
            File temporary = new File(getFilesDir(), "probe.json.tmp");
            try (FileOutputStream stream = new FileOutputStream(temporary)) {
                stream.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
                stream.getFD().sync();
            }
            if (!temporary.renameTo(new File(getFilesDir(), "probe.json"))) throw new IOException("rename failed");
            JSONObject connect = report.getJSONObject("connect");
            status.setText("检查已结束\n\n连接端口：" + connect.opt("port")
                    + "\n结果：" + ("candidate".equals(connect.optString("state")) ? "发现本机候选端口" : "尚未确认")
                    + "\n\n仅完成端口发现检查，尚未接入业务。\n没有向服务器上报。\n点击重新检查可再次运行。");
        } catch (JSONException | IOException error) {
            status.setText("诊断记录保存失败：" + error.getClass().getSimpleName());
        }
    }

    @Override protected void onPause() {
        finishProbe("foreground_ended");
        super.onPause();
    }
}
