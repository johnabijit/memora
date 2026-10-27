package com.memora.mobile;

import android.Manifest;
import android.content.Context;
import androidx.fragment.app.FragmentActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.browser.customtabs.CustomTabsIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
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

public class MainActivity extends FragmentActivity {
    private static final String HOME = "https://memora-37z.pages.dev/";
    private static final int FILE_PICK_REQUEST = 1001;
    private static final int MEDIA_PERMISSION_REQUEST = 1002;
    private static final int LOCATION_PERMISSION_REQUEST = 1003;
    private android.webkit.GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private WebView webView;
    private float touchStartY=0f;
    private boolean refreshing=false;
    private LinearLayout errorPanel;
    private WebChromeClient.FileChooserParams pendingFileParams;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private PermissionRequest mediaRequest;
    private String[] mediaResources;
    private ProgressBar loading;
    private View lockCover;
    private boolean authInProgress=false;
    private boolean unlockedThisResume=false;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(12,16,25));
        getWindow().setNavigationBarColor(Color.rgb(12,16,25));
        initUi();
        if (state != null) webView.restoreState(state);
        String callbackUrl = callbackUrlFromIntent(getIntent());
        if (callbackUrl != null) openAuthCallback(callbackUrl);
        else if (state == null) webView.loadUrl(quickAskIntent(getIntent()) ? HOME + "?view=ask&quick=1" : HOME);
    }

    private void initUi() {
        android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(12,16,25));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12,16,25));
        webView.setOnTouchListener((view,event)->{
            if(event.getActionMasked()==android.view.MotionEvent.ACTION_DOWN){touchStartY=event.getY();return false;}
            if(event.getActionMasked()==android.view.MotionEvent.ACTION_UP){
                float distance=event.getY()-touchStartY;
                if(distance>dp(125)&&webView.getScrollY()==0&&!refreshing&&!authInProgress){
                    refreshing=true;
                    loading.setVisibility(View.VISIBLE);
                    webView.reload();
                    return true;
                }
            }
            return false;
        });
        frame.addView(webView,new android.widget.FrameLayout.LayoutParams(-1,-1));
        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " MemoraAndroid/2.0");
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
        title.setText("Ormemora couldn't load");
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
        retry.setText("Retry Ormemora");
        retry.setOnClickListener(v -> { errorPanel.setVisibility(View.GONE); loading.setVisibility(View.VISIBLE); webView.loadUrl(HOME); });
        errorPanel.addView(retry);
        Button browser = new Button(this);
        browser.setText("Open in browser");
        browser.setOnClickListener(v -> openExternally(Uri.parse(HOME)));
        errorPanel.addView(browser);
        frame.addView(errorPanel,new android.widget.FrameLayout.LayoutParams(-1,-1));
        errorPanel.setVisibility(View.GONE);
        lockCover=createLockOverlay();
        frame.addView(lockCover,new android.widget.FrameLayout.LayoutParams(-1,-1));
        if(!deviceLockEnabled()) lockCover.setVisibility(View.GONE);
        else webView.setVisibility(View.INVISIBLE);
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
                refreshing=false;
                CookieManager.getInstance().flush();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { loading.setVisibility(View.GONE); errorPanel.setVisibility(View.VISIBLE); }
            }
        });
        webView.getSettings().setGeolocationEnabled(true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback){
                Uri uri=Uri.parse(origin);
                if(!"https".equalsIgnoreCase(uri.getScheme())||!"memora-37z.pages.dev".equalsIgnoreCase(uri.getHost())){callback.invoke(origin,false,false);return;}
                if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED){callback.invoke(origin,true,false);return;}
                geoCallback=callback;
                geoOrigin=origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_PERMISSION_REQUEST);
            }
            @Override public void onGeolocationPermissionsHidePrompt(){}
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
        else if(quickAskIntent(intent)){webView.loadUrl(HOME+"?view=ask&quick=1");}
    }

    private boolean quickAskIntent(Intent intent){
        if(intent==null)return false;
        Uri uri=intent.getData();
        return uri!=null && "memora".equalsIgnoreCase(uri.getScheme())
            && "shortcut".equalsIgnoreCase(uri.getHost())
            && "/quick-ask".equals(uri.getPath());
    }

    private void pinQuickAskShortcut(){
        if(Build.VERSION.SDK_INT<26){
            Toast.makeText(this,"Home-screen shortcut pinning requires Android 8 or later.",Toast.LENGTH_LONG).show();
            return;
        }
        ShortcutManager manager=getSystemService(ShortcutManager.class);
        if(manager==null || !manager.isRequestPinShortcutSupported()){
            Toast.makeText(this,"Your launcher does not support pinned shortcuts.",Toast.LENGTH_LONG).show();
            return;
        }
        Intent intent=new Intent(this,MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("memora://shortcut/quick-ask"));
        ShortcutInfo shortcut=new ShortcutInfo.Builder(this,"memora-quick-ask")
            .setShortLabel("Quick Ask")
            .setLongLabel("Ask Ormemora")
            .setIcon(Icon.createWithResource(this,com.memora.mobile.R.mipmap.ic_ormemora))
            .setIntent(intent)
            .build();
        manager.requestPinShortcut(shortcut,null);
    }

    private boolean deviceLockEnabled(){
        return getSharedPreferences("memora-security",Context.MODE_PRIVATE)
            .getBoolean("device-lock-enabled",false);
    }

    private View createLockOverlay(){
        LinearLayout cover=new LinearLayout(this);
        cover.setBackgroundColor(Color.rgb(12,16,25));
        cover.setGravity(Gravity.CENTER);
        cover.setOrientation(LinearLayout.VERTICAL);
        cover.setPadding(dp(30),dp(30),dp(30),dp(30));
        TextView title=new TextView(this);
        title.setText("Ormemora is locked");
        title.setTextColor(Color.WHITE);
        title.setTextSize(25);
        title.setGravity(Gravity.CENTER);
        cover.addView(title,new LinearLayout.LayoutParams(-1,dp(64)));
        TextView note=new TextView(this);
        note.setText("Unlock using your phone's fingerprint, face or screen lock.");
        note.setTextColor(Color.LTGRAY);
        note.setGravity(Gravity.CENTER);
        cover.addView(note,new LinearLayout.LayoutParams(-1,dp(80)));
        Button unlock=new Button(this);
        unlock.setText("Unlock Ormemora");
        unlock.setOnClickListener(view->requestDeviceAuth("unlock"));
        cover.addView(unlock);
        return cover;
    }

    private void revealWebView(){
        unlockedThisResume=true;
        if(webView!=null)webView.setVisibility(View.VISIBLE);
        if(lockCover!=null)lockCover.setVisibility(View.GONE);
    }

    private void requestDeviceAuth(String purpose){
        if(authInProgress)return;
        int accepted=BiometricManager.Authenticators.BIOMETRIC_STRONG |
            BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        int available=BiometricManager.from(this).canAuthenticate(accepted);
        if(available!=BiometricManager.BIOMETRIC_SUCCESS){
            Toast.makeText(this,"Set up a device PIN and fingerprint or face unlock in Android Settings first.",Toast.LENGTH_LONG).show();
            return;
        }
        authInProgress=true;
        BiometricPrompt prompt=new BiometricPrompt(this,ContextCompat.getMainExecutor(this),
            new BiometricPrompt.AuthenticationCallback(){
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result){
                    super.onAuthenticationSucceeded(result);
                    authInProgress=false;
                    if("enable".equals(purpose)){
                        getSharedPreferences("memora-security",Context.MODE_PRIVATE).edit()
                            .putBoolean("device-lock-enabled",true).apply();
                        Toast.makeText(MainActivity.this,"Device unlock enabled for Ormemora",Toast.LENGTH_LONG).show();
                    }else if("disable".equals(purpose)){
                        getSharedPreferences("memora-security",Context.MODE_PRIVATE).edit()
                            .putBoolean("device-lock-enabled",false).apply();
                        Toast.makeText(MainActivity.this,"Ormemora device unlock disabled",Toast.LENGTH_LONG).show();
                    }
                    revealWebView();
                }
                @Override public void onAuthenticationError(int errorCode,CharSequence errString){
                    super.onAuthenticationError(errorCode,errString);
                    authInProgress=false;
                    if(deviceLockEnabled()&&!unlockedThisResume){
                        if(lockCover!=null)lockCover.setVisibility(View.VISIBLE);
                        if(webView!=null)webView.setVisibility(View.INVISIBLE);
                    }
                }
            });
        BiometricPrompt.PromptInfo info=new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Ormemora device security")
            .setSubtitle("Confirm your device identity")
            .setAllowedAuthenticators(accepted).build();
        try{prompt.authenticate(info);}
        catch(Exception e){
            authInProgress=false;
            Toast.makeText(this,"Device authentication is not available. Check Android security settings.",Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onPause(){
        if(deviceLockEnabled()){
            unlockedThisResume=false;
            if(webView!=null)webView.setVisibility(View.INVISIBLE);
            if(lockCover!=null)lockCover.setVisibility(View.VISIBLE);
        }
        super.onPause();
    }

    @Override protected void onResume(){
        super.onResume();
        if(deviceLockEnabled()&&!unlockedThisResume&&!authInProgress){
            if(webView!=null)webView.setVisibility(View.INVISIBLE);
            if(lockCover!=null)lockCover.setVisibility(View.VISIBLE);
            requestDeviceAuth("unlock");
        }
    }

    private int dp(int value) { return (int)(getResources().getDisplayMetrics().density * value + .5f); }

    private boolean handleNavigation(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if("memora".equalsIgnoreCase(scheme)&&"shortcut".equalsIgnoreCase(host)&&"/quick-ask".equals(uri.getPath())){
            runOnUiThread(()->pinQuickAskShortcut());return true;
        }
        if("memora".equalsIgnoreCase(scheme)&&"security".equalsIgnoreCase(host)){
            String path=uri.getPath();
            // An OS-verified prompt is always required before changing the
            // device-lock preference. No JavaScript bridge exposes credentials.
            if("/enable".equals(path)){runOnUiThread(()->requestDeviceAuth("enable"));return true;}
            if("/disable".equals(path)){runOnUiThread(()->requestDeviceAuth("disable"));return true;}
            return true;
        }
        if ("https".equalsIgnoreCase(scheme) && host != null) {
            // The only pages displayed inside the WebView are Ormemora pages.
            // Identity providers open securely inside an in-app Custom Tab, never in the WebView.
            if (host.equalsIgnoreCase("memora-37z.pages.dev")) return false;
            if (isIdentityProvider(uri)) openIdentityTab(uri);
            else openExternally(uri);
            return true;
        }
        if ("http".equalsIgnoreCase(scheme) || "mailto".equalsIgnoreCase(scheme) || "tel".equalsIgnoreCase(scheme)) {
            openExternally(uri);
            return true;
        }
        return false;
    }

    private boolean isIdentityProvider(Uri uri) {
        String host = uri.getHost();
        if (host == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String h = host.toLowerCase(java.util.Locale.ROOT);
        return h.equals("accounts.google.com") || h.equals("login.microsoftonline.com")
            || h.equals("appleid.apple.com") || h.equals("www.facebook.com")
            || h.equals("github.com") || h.equals("ueinbsvqihczmxpkctcq.supabase.co");
    }

    private void openIdentityTab(Uri uri) {
        try {
            CustomTabsIntent customTab = new CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setToolbarColor(Color.rgb(12, 23, 42))
                .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                .build();
            customTab.launchUrl(this, uri);
        } catch (Exception error) {
            openExternally(uri);
        }
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
        if(req==LOCATION_PERMISSION_REQUEST){
            boolean granted=false;
            for(int result:grantResults)if(result==PackageManager.PERMISSION_GRANTED)granted=true;
            if(geoCallback!=null){geoCallback.invoke(geoOrigin,granted,false);geoCallback=null;geoOrigin=null;}
            if(!granted)Toast.makeText(this,"Location permission denied. Allow location in Android Settings to attach a place.",Toast.LENGTH_LONG).show();
            return;
        }
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
