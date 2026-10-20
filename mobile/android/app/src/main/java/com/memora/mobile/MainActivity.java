package com.memora.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final String HOME = "https://memora-37z.pages.dev/";
    private static final int FILE_PICK_REQUEST = 1001;
    private static final int MEDIA_PERMISSION_REQUEST = 1002;
    private WebView webView;
    private LinearLayout errorPanel;
    private WebChromeClient.FileChooserParams pendingFileParams;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private PermissionRequest mediaRequest;
    private String[] mediaResources;
    private ProgressBar loading;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(12,16,25));
        getWindow().setNavigationBarColor(Color.rgb(12,16,25));
        initUi();
        if (state != null) webView.restoreState(state);
        String callbackUrl = callbackUrlFromIntent(getIntent());
        if (callbackUrl != null) openAuthCallback(callbackUrl);
        else if (state == null) webView.loadUrl(HOME);
    }

    private void initUi() {
        android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(12,16,25));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12,16,25));
        frame.addView(webView,new android.widget.FrameLayout.LayoutParams(-1,-1));
        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " MemoraAndroid/1.2");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        loading = new ProgressBar(this);
        android.widget.FrameLayout.LayoutParams indicator = new android.widget.FrameLayout.LayoutParams(dp(42),dp(42),Gravity.CENTER);
        frame.addView(loading,indicator);
        loading.setVisibility(View.VISIBLE);

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28),dp(28),dp(28),dp(28));
        errorPanel.setBackgroundColor(Color.rgb(12,16,25));
        TextView title = new TextView(this);
        title.setText("Memora couldn't load");
        title.setTextColor(Color.WHITE);
        title.setTextSize(23);
        title.setGravity(Gravity.CENTER);
        errorPanel.addView(title,new LinearLayout.LayoutParams(-1,dp(60)));
        TextView details = new TextView(this);
        details.setText("Check your internet connection. Your memories are still safely stored online.");
        details.setTextColor(Color.LTGRAY);
        details.setGravity(Gravity.CENTER);
        errorPanel.addView(details,new LinearLayout.LayoutParams(-1,dp(65)));
        Button retry = new Button(this);
        retry.setText("Retry Memora");
        retry.setOnClickListener(v -> { errorPanel.setVisibility(View.GONE); loading.setVisibility(View.VISIBLE); webView.loadUrl(HOME); });
        errorPanel.addView(retry);
        Button browser = new Button(this);
        browser.setText("Open in browser");
        browser.setOnClickListener(v -> openExternally(Uri.parse(HOME)));
        errorPanel.addView(browser);
        frame.addView(errorPanel,new android.widget.FrameLayout.LayoutParams(-1,-1));
        errorPanel.setVisibility(View.GONE);
        setContentView(frame);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                loading.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { loading.setVisibility(View.GONE); errorPanel.setVisibility(View.VISIBLE); }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                pendingFileParams = params;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_PICK_REQUEST);
                    return true;
                } catch (ActivityNotFoundException ex) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this,"File selection is not available",Toast.LENGTH_LONG).show();
                    return true;
                }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleMediaPermission(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (mediaRequest == request) { mediaRequest = null; mediaResources = null; }
            }
        });
    }

    // Accept only a temporary authorization code; never deep-link access tokens.
    // The WebView's PKCE code verifier is used by supabase-js for exchange.
    private String callbackUrlFromIntent(Intent intent) {
        if (intent == null) return null;
        Uri uri = intent.getData();
        if (uri == null || !"memora".equalsIgnoreCase(uri.getScheme()) ||
            !"auth".equalsIgnoreCase(uri.getHost()) ||
            !"/callback".equals(uri.getPath())) return null;
        String code = uri.getQueryParameter("code");
        if (code == null || !code.matches("^[A-Za-z0-9_-]{8,2048}$")) return null;
        return HOME + "?code=" + Uri.encode(code);
    }

    private void openAuthCallback(String url) {
        errorPanel.setVisibility(View.GONE);
        loading.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = callbackUrlFromIntent(intent);
        if (url != null) openAuthCallback(url);
    }

    private int dp(int value) { return (int)(getResources().getDisplayMetrics().density * value + .5f); }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ("https".equalsIgnoreCase(scheme) && host != null) {
            // The only pages displayed inside the WebView are Memora pages.
            // All external identity-provider and third-party pages open in the phone browser.
            if (host.equalsIgnoreCase("memora-37z.pages.dev")) return false;
            openExternally(uri);
            return true;
        }
        if ("http".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)) {
            openExternally(uri);
            return true;
        }
        return false;
    }

    private void openExternally(Uri uri) {
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); }
        catch (Exception ignored) { Toast.makeText(this,"No application can open this link",Toast.LENGTH_LONG).show(); }
    }

    private void handleMediaPermission(PermissionRequest req) {
        String host = req.getOrigin() == null ? "" : req.getOrigin().getHost();
        if (!"memora-37z.pages.dev".equalsIgnoreCase(host)) { req.deny(); return; }
        java.util.ArrayList<String> accepted = new java.util.ArrayList<>();
        java.util.ArrayList<String> required = new java.util.ArrayList<>();
        for (String resource : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                accepted.add(resource);
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                    required.add(Manifest.permission.RECORD_AUDIO);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                accepted.add(resource);
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                    required.add(Manifest.permission.CAMERA);
            }
        }
        if (accepted.isEmpty()) { req.deny(); return; }
        if (required.isEmpty()) { req.grant(accepted.toArray(new String[0])); return; }
        mediaRequest = req;
        mediaResources = accepted.toArray(new String[0]);
        requestPermissions(required.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
    }

    @Override public void onRequestPermissionsResult(int req, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(req,permissions,grantResults);
        if (req == MEDIA_PERMISSION_REQUEST && mediaRequest != null) {
            boolean allowed = true;
            for (int result : grantResults) if (result != PackageManager.PERMISSION_GRANTED) allowed = false;
            if (grantResults.length == 0) allowed = false;
            if (allowed) mediaRequest.grant(mediaResources);
            else mediaRequest.deny();
            mediaRequest = null;
            mediaResources = null;
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request,result,data);
        if (request == FILE_PICK_REQUEST && fileCallback != null) {
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result,data);
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
            pendingFileParams = null;
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override public void onSaveInstanceState(Bundle state) {
        if (webView != null) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (mediaRequest != null) mediaRequest.deny();
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
