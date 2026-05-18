package dev.neobabylon.webview

import android.app.Application

class NeoBabylonApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val prefs = getSharedPreferences(NeoBridge.PREFS_NAME, MODE_PRIVATE)
        MemorySync.schedule(prefs)
    }
}
