package com.memora.personal;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.net.Uri;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.webkit.ValueCallback;

public class MainActivity extends Activity {
  private WebView web;
  private GeolocationPermissions.Callback geoCallback;
  private String geoOrigin;
  private ValueCallback<Uri[]> fileCallback;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    FrameLayout layout=new FrameLayout(this);
    web=new WebView(this);
    layout.addView(web,new FrameLayout.LayoutParams(-1,-1));
    setContentView(layout);
    WebSettings settings=web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setGeolocationEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        Uri uri=request.getUrl();
        if(!"https".equals(uri.getScheme())) { try {startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){} return true; }
        String host=uri.getHost();
        if(host!=null && (host.equals("accounts.google.com")||host.endsWith(".appleid.apple.com"))){
          startActivity(new Intent(Intent.ACTION_VIEW,uri));return true;
        }
        return false;
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
        geoOrigin=origin;geoCallback=callback;
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) callback.invoke(origin,true,false);
        else requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},201);
      }
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> cb,FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=cb;
        try {startActivityForResult(params.createIntent(),202);return true;}
        catch(Exception e){fileCallback=null;return false;}
      }
    });
    web.loadUrl("https://memora-37z.pages.dev/?view=home");
  }
  @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){
    super.onRequestPermissionsResult(code,permissions,grants);
    if(code==201&&geoCallback!=null){geoCallback.invoke(geoOrigin,grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED,false);geoCallback=null;}
  }
  @Override protected void onActivityResult(int code,int result,Intent data){
    super.onActivityResult(code,result,data);
    if(code==202&&fileCallback!=null){fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileCallback=null;}
  }
  @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){web.destroy();super.onDestroy();}
}
