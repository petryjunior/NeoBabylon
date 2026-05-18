package dev.neobabylon.webview

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs = getSharedPreferences(NeoBridge.PREFS_NAME, MODE_PRIVATE)
        val apiKeyField = findViewById<TextInputEditText>(R.id.apiKeyField)
        val targetLangField = findViewById<TextInputEditText>(R.id.targetLangField)
        val includeDefinitionSwitch = findViewById<SwitchMaterial>(R.id.includeDefinitionSwitch)
        val saveButton = findViewById<MaterialButton>(R.id.saveButton)

        apiKeyField.setText(prefs.getString("apiKey", "").orEmpty())
        targetLangField.setText(
            prefs.getString("targetLang", null)?.trim().orEmpty().ifEmpty { "English" },
        )
        includeDefinitionSwitch.isChecked = prefs.getBoolean("includeDefinition", true)

        saveButton.setOnClickListener {
            prefs
                .edit()
                .putString("apiKey", apiKeyField.text?.toString()?.trim().orEmpty())
                .putString(
                    "targetLang",
                    targetLangField.text?.toString()?.trim().orEmpty().ifEmpty { "English" },
                )
                .putBoolean("includeDefinition", includeDefinitionSwitch.isChecked)
                .apply()
            MemorySync.schedule(prefs)
            finish()
        }
    }
}
