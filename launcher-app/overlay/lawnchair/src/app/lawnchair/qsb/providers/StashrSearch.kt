package app.lawnchair.qsb.providers

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import com.android.launcher3.Launcher
import com.android.launcher3.R

/**
 * Stashr Search: tapping the dock search bar opens the Stashr app's search (app screens, bank-statement lines, the house, Google results
 * and an AI answer). It is the default search when the Stashr app is installed; if it is not, the launcher falls back to the next provider
 * (Google), and if the app is removed later a tap opens Google's website instead of doing nothing.
 */
data object StashrSearch : QsbSearchProvider(
    id = "stashr_search",
    name = R.string.search_provider_stashr_search,
    icon = R.drawable.ic_qsb_search,
    packageName = "com.tanush.stashr.com",
    className = "com.tanush.stashr.com.MainActivity",
    action = Intent.ACTION_VIEW,
    website = "https://www.google.com/",
) {
    override suspend fun launch(launcher: Launcher, forceWebsite: Boolean) {
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("stashr://search"))
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            launcher.startActivity(open)
        } catch (_: ActivityNotFoundException) {
            super.launch(launcher, true)
        }
    }
}
