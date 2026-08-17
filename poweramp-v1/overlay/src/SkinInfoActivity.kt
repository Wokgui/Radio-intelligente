package com.poweramp.v3.sampleskin

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import com.maxmpz.poweramp.player.PowerampAPIHelper.getPowerampPackageName

internal fun Context.getPaPak(): String? = getPowerampPackageName(this, false).also {
    if (it == null) Toast.makeText(this, "Poweramp n'est pas installé", Toast.LENGTH_LONG).show()
}

class SkinInfoActivity : Activity() {
    companion object { var skinVerifiedOnce = false }

    data class Theme(val name:String, val mood:String, val bg:Int, val accent:Int, val style:Int)

    private lateinit var preview: LinearLayout
    private lateinit var title: TextView
    private lateinit var accentBar: View
    private lateinit var apply: Button
    private var selected = 0

    private val themes by lazy { listOf(
        Theme("Minuit violet", "profond · élégant", Color.rgb(18,13,29), Color.rgb(167,123,255), R.style.HugoSkinMidnightViolet),
        Theme("Océan nocturne", "frais · immersif", Color.rgb(7,26,43), Color.rgb(77,182,232), R.style.HugoSkinDeepOcean),
        Theme("Néon coucher de soleil", "rétro · vibrant", Color.rgb(23,16,36), Color.rgb(255,92,138), R.style.HugoSkinNeonSunset),
        Theme("Jade profond", "calme · naturel", Color.rgb(13,33,28), Color.rgb(85,214,169), R.style.HugoSkinJade),
        Theme("Graphite ambré", "sobre · chaleureux", Color.rgb(27,28,32), Color.rgb(255,177,74), R.style.HugoSkinAmberGraphite),
        Theme("Bordeaux rosé", "feutré · raffiné", Color.rgb(42,16,26), Color.rgb(240,120,160), R.style.HugoSkinBurgundyRose),
        Theme("Ardoise glacée", "moderne · doux", Color.rgb(24,33,41), Color.rgb(143,201,232), R.style.HugoSkinSlateIce),
        Theme("Espresso cuivré", "chaud · discret", Color.rgb(36,26,22), Color.rgb(217,154,108), R.style.HugoSkinCopperEspresso)
    ) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(18),dp(18),dp(18),dp(26)); setBackgroundColor(Color.rgb(15,15,18)) }
        val scroll = ScrollView(this); scroll.addView(root); setContentView(scroll)

        root.addView(TextView(this).apply { text="Aperçu en direct"; textSize=24f; setTextColor(Color.WHITE) })
        root.addView(TextView(this).apply { text="Touchez un accord de couleurs : la miniature change immédiatement."; textSize=14f; setTextColor(Color.LTGRAY); setPadding(0,dp(4),0,dp(14)) })

        preview = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER; setPadding(dp(16),dp(16),dp(16),dp(16)); layoutParams=LinearLayout.LayoutParams(-1,dp(300)) }
        val cover = TextView(this).apply { text="♪"; gravity=Gravity.CENTER; textSize=58f; setTextColor(Color.WHITE); layoutParams=LinearLayout.LayoutParams(dp(160),dp(160)) }
        preview.addView(cover)
        title = TextView(this).apply { textSize=18f; setTextColor(Color.WHITE); gravity=Gravity.CENTER; setPadding(0,dp(10),0,dp(8)) }
        preview.addView(title)
        accentBar = View(this).apply { layoutParams=LinearLayout.LayoutParams(-1,dp(7)) }
        preview.addView(accentBar)
        preview.addView(TextView(this).apply { text="◀    ▶    ▷"; textSize=28f; gravity=Gravity.CENTER; setTextColor(Color.WHITE); setPadding(0,dp(12),0,0) })
        root.addView(preview)

        root.addView(TextView(this).apply { text="Accords esthétiques"; textSize=20f; setTextColor(Color.WHITE); setPadding(0,dp(22),0,dp(8)) })
        themes.forEachIndexed { i,t ->
            val row = LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL; setPadding(dp(12),dp(10),dp(12),dp(10)); background=rounded(t.bg,14f); setOnClickListener { selected=i; render() } }
            row.addView(View(this).apply { background=rounded(t.accent,20f); layoutParams=LinearLayout.LayoutParams(dp(34),dp(34)) })
            row.addView(TextView(this).apply { text="  ${t.name}\n  ${t.mood}"; textSize=16f; setTextColor(Color.WHITE); layoutParams=LinearLayout.LayoutParams(0,-2,1f) })
            root.addView(row, LinearLayout.LayoutParams(-1,-2).apply { setMargins(0,dp(5),0,dp(5)) })
        }

        apply = Button(this).apply { text="Appliquer dans Poweramp"; setOnClickListener { applyTheme() } }
        root.addView(apply, LinearLayout.LayoutParams(-1,-2).apply { setMargins(0,dp(18),0,0) })
        render()
    }

    private fun render() {
        val t=themes[selected]
        preview.background=rounded(t.bg,22f)
        title.text="${t.name}\n${t.mood}"
        accentBar.setBackgroundColor(t.accent)
        apply.text="Appliquer « ${t.name} »"
    }

    private fun applyTheme() {
        val pak=getPaPak() ?: return
        val t=themes[selected]
        startActivity(Intent(Intent.ACTION_MAIN).setClassName(pak,"com.maxmpz.audioplayer.StartupActivity").putExtra("theme_pak",packageName).putExtra("theme_id",t.style))
    }

    private fun rounded(color:Int, radius:Float)=GradientDrawable().apply { setColor(color); cornerRadius=dp(radius.toInt()).toFloat() }
    private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()
}
