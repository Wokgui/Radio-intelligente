package app.radiointelligente;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String APP_HOST = "app.local";
    private static final String HOME_URL = "http://" + APP_HOST + "/index.html";
    private static final int FILE_CHOOSER_REQUEST = 7001;
    private static final String NOTUBE_BASE = "https://notube.lol/fr/youtube-app-394";

    private static final Pattern VIDEO_RENDERER =
            Pattern.compile("\\"videoRenderer\\":\\\\{\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"");
    private static final Pattern VIDEO_FALLBACK =
            Pattern.compile("\\"videoId\\":\\"([A-Za-z0-9_-]{11})\\"");

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(111, 66, 193));
        getWindow().setNavigationBarColor(Color.BLACK);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    if ("/api/youtube-search".equals(uri.getPath())) {
                        return handleYoutubeSearch(uri);
                    }
                    return serveBundledAsset(uri.getPath());
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();

                if (APP_HOST.equalsIgnoreCase(host)) {
                    return false;
                }

                if (!request.isForMainFrame()) {
                    return false;
                }

                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    return false;
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                Intent intent;
                try {
                    intent = params.createIntent();
                } catch (Exception e) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.setType("audio/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                }

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private WebResourceResponse serveBundledAsset(String rawPath) {
        String path = rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)
                ? "index.html"
                : rawPath.substring(1);

        if (path.contains("..")) {
            return textResponse(403, "Forbidden", "text/plain", "Accès refusé");
        }

        try {
            InputStream stream = getAssets().open(path);
            return new WebResourceResponse(mimeType(path), encodingFor(path), stream);
        } catch (IOException e) {
            return textResponse(404, "Not Found", "text/plain", "Ressource introuvable : " + path);
        }
    }

    private WebResourceResponse handleYoutubeSearch(Uri uri) {
        String query = value(uri.getQueryParameter("q"));
        String target = value(uri.getQueryParameter("target"));
        boolean redirect = "1".equals(uri.getQueryParameter("redirect"));

        if (query.isEmpty()) {
            return jsonResponse(400, "{\"error\":\"Recherche manquante.\"}");
        }

        HttpURLConnection connection = null;
        try {
            String searchUrl = "https://www.youtube.com/results?search_query="
                    + URLEncoder.encode(query, StandardCharsets.UTF_8.name());
            connection = (HttpURLConnection) new URL(searchUrl).openConnection();
            connection.setConnectTimeout(9000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/127 Safari/537.36");
            connection.setRequestProperty("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8");
            connection.setRequestProperty("Cookie", "SOCS=CAI");

            int status = connection.getResponseCode();
            if (status < 200 || status >= 400) throw new IOException("YouTube HTTP " + status);

            String html = readString(connection.getInputStream());
            String videoId = firstVideoId(html);
            if (videoId.isEmpty()) throw new IOException("Vidéo introuvable");

            String youtubeUrl = "https://www.youtube.com/watch?v=" + videoId;
            String destination;
            if ("download".equals(target)) {
                destination = NOTUBE_BASE + "?v=" + URLEncoder.encode(videoId, StandardCharsets.UTF_8.name());
            } else if ("embed".equals(target)) {
                destination = "https://www.youtube-nocookie.com/embed/" + videoId
                        + "?controls=1&playsinline=1&rel=0";
            } else {
                destination = youtubeUrl;
            }

            if (redirect) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Location", destination);
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(
                        "text/plain",
                        "UTF-8",
                        302,
                        "Found",
                        headers,
                        new ByteArrayInputStream(new byte[0])
                );
            }

            String json = "{\"videoId\":\"" + videoId
                    + "\",\"youtubeUrl\":\"" + escapeJson(youtubeUrl)
                    + "\",\"destination\":\"" + escapeJson(destination) + "\"}";
            return jsonResponse(200, json);
        } catch (Exception e) {
            String fallback = "download".equals(target)
                    ? NOTUBE_BASE
                    : "https://www.youtube.com/results?search_query=" + Uri.encode(query);
            if (redirect) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Location", fallback);
                return new WebResourceResponse(
                        "text/plain",
                        "UTF-8",
                        302,
                        "Found",
                        headers,
                        new ByteArrayInputStream(new byte[0])
                );
            }
            return jsonResponse(502, "{\"error\":\"Recherche YouTube indisponible.\",\"destination\":\""
                    + escapeJson(fallback) + "\"}");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String firstVideoId(String html) {
        Matcher renderer = VIDEO_RENDERER.matcher(html);
        if (renderer.find()) return renderer.group(1);
        Matcher fallback = VIDEO_FALLBACK.matcher(html);
        return fallback.find() ? fallback.group(1) : "";
    }

    private static String readString(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = stream.read(buffer)) != -1) out.write(buffer, 0, count);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static String value(String value) {
        return value == null ? "" : value.trim();
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private WebResourceResponse jsonResponse(int statusCode, String json) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse(
                "application/json",
                "UTF-8",
                statusCode,
                statusCode >= 400 ? "Error" : "OK",
                headers,
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8))
        );
    }

    private WebResourceResponse textResponse(int statusCode, String reason, String mime, String text) {
        return new WebResourceResponse(
                mime,
                "UTF-8",
                statusCode,
                reason,
                new HashMap<>(),
                new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8))
        );
    }

    private static String mimeType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private static String encodingFor(String path) {
        String p = path.toLowerCase();
        return (p.endsWith(".html") || p.endsWith(".css") || p.endsWith(".js")
                || p.endsWith(".json") || p.endsWith(".webmanifest") || p.endsWith(".svg"))
                ? "UTF-8" : null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK) {
                results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            if (fileCallback != null) {
                fileCallback.onReceiveValue(results);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
