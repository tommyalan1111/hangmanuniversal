package com.hangmanuniversal.game;

import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Without this call the compat splash library never installs, so the
           launch theme's windowSplashScreenAnimatedIcon is ignored. */
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
