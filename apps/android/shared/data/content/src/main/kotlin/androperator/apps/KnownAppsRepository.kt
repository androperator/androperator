package androperator.apps

import action.system.model.ApplicationId
import kotlinx.coroutines.flow.Flow

interface KnownAppsRepository {
    val audioApplicationIds: Flow<List<ApplicationId>>
    val browserApplicationIds: Flow<List<ApplicationId>>
    val calendarApplicationIds: Flow<List<ApplicationId>>
    val cameraApplicationIds: Flow<List<ApplicationId>>
    val chatBotApplicationIds: Flow<List<ApplicationId>>
    val chromeApplicationIds: Flow<List<ApplicationId>>
    val cryptoApplicationIds: Flow<List<ApplicationId>>
    val emailApplicationIds: Flow<List<ApplicationId>>
    val galleryApplicationIds: Flow<List<ApplicationId>>

    // Actual games
    val gameApplicationIds: Flow<List<ApplicationId>>

    // Gaming apps such as Xbox, PlayStation, Nintendo Switch, etc.
    val gamingApplicationIds: Flow<List<ApplicationId>>
    val mapsApplicationIds: Flow<List<ApplicationId>>
    val messagingApplicationIds: Flow<List<ApplicationId>>
    val musicApplicationIds: Flow<List<ApplicationId>>
    val newsApplicationIds: Flow<List<ApplicationId>>
    val phoneApplicationIds: Flow<List<ApplicationId>>
    val productivityApplicationIds: Flow<List<ApplicationId>>
    val searchEndpointApplicationIds: Flow<List<ApplicationId>>
    val shoppingApplicationIds: Flow<List<ApplicationId>>
    val socialApplicationIds: Flow<List<ApplicationId>>
    val videoApplicationIds: Flow<List<ApplicationId>>

    val amazonApplicationId: ApplicationId get() = "com.amazon.mShop.android.shopping"
    val amazonMusicApplicationId: ApplicationId get() = "com.amazon.mp3"
    val appleMusicApplicationId: ApplicationId get() = "com.apple.android.music"
    val audibleApplicationId: ApplicationId get() = "com.audible.application"
    val binanceApplicationId: ApplicationId get() = "com.binance.dev"
    val binanceUsApplicationId: ApplicationId get() = "com.binance.us"
    val bingApplicationId: ApplicationId get() = "com.microsoft.bing"
    val braveApplicationId: ApplicationId get() = "com.brave.browser"
    val chatGptApplicationId: ApplicationId get() = "com.openai.chatgpt"
    val chromeApplicationId: ApplicationId get() = "com.android.chrome"
    val chromeBetaApplicationId: ApplicationId get() = "com.chrome.beta"
    val chromeCanaryApplicationId: ApplicationId get() = "com.chrome.canary"
    val chromeDevApplicationId: ApplicationId get() = "com.chrome.dev"
    val claudeApplicationId: ApplicationId get() = "com.anthropic.claude"
    val coinbaseApplicationId: ApplicationId get() = "com.coinbase.android"
    val coinbaseWalletApplicationId: ApplicationId get() = "com.coinbase.android.wallet"
    val deepSeekApplicationId: ApplicationId get() = "com.deepseek.chat"
    val discordApplicationId: ApplicationId get() = "com.discord"
    val disneyPlusApplicationId: ApplicationId get() = "com.disney.disneyplus"
    val duckDuckGoApplicationId: ApplicationId get() = "com.duckduckgo.mobile.android"
    val facebookApplicationId: ApplicationId get() = "com.facebook.katana"
    val flipboardApplicationId: ApplicationId get() = "flipboard.app"
    val gmailApplicationId: ApplicationId get() = "com.google.android.gm"
    val googleClock: ApplicationId get() = "com.google.android.deskclock"
    val googleDialerApplicationId: ApplicationId get() = "com.google.android.dialer"
    val googleDriveApplicationId: ApplicationId get() = "com.google.android.apps.docs"
    val googleGamesApplicationId: ApplicationId get() = "com.google.android.play.games"
    val googleGeminiApplicationId: ApplicationId get() = "com.google.android.apps.bard"
    val googleHomeApplicationId: ApplicationId get() = "com.google.android.apps.chromecast.app"
    val googleMapsApplicationId: ApplicationId get() = "com.google.android.apps.maps"
    val googleNewsApplicationId: ApplicationId get() = "com.google.android.apps.magazines"
    val googlePhotosApplicationId: ApplicationId get() = "com.google.android.apps.photos"
    val googlePlayApplicationId: ApplicationId get() = "com.android.vending"
    val googleSearchApplicationId: ApplicationId get() = "com.google.android.googlequicksearchbox"
    val googleSmsApplicationId: ApplicationId get() = "com.google.android.apps.messaging"
    val googleWallpaperApplicationId: ApplicationId get() = "com.google.android.apps.wallpaper"
    val grokApplicationId: ApplicationId get() = "ai.x.grok"
    val homeAssistantApplicationId: ApplicationId get() = "io.homeassistant.companion.android"
    val instagramApplicationId: ApplicationId get() = "com.instagram.android"
    val krakenApplicationId: ApplicationId get() = "com.kraken.invest.app"
    val manusAi: ApplicationId get() = "tech.butterfly.app"
    val messengerApplicationId: ApplicationId get() = "com.facebook.orca"
    val metaAi: ApplicationId get() = "com.facebook.stella"
    val microsoftCopilot: ApplicationId get() = "com.microsoft.copilot"
    val mistralApplicationId: ApplicationId get() = "ai.mistral.chat"
    val netflixApplicationId: ApplicationId get() = "com.netflix.mediaclient"
    val nintendoSwitchApplicationId: ApplicationId get() = "com.nintendo.switch"
    val nintendoSwitchParentControlsApplicationId: ApplicationId get() = "com.nintendo.znma"
    val outlookApplicationId: ApplicationId get() = "com.microsoft.office.outlook"
    val perplexityApplicationId: ApplicationId get() = "ai.perplexity.app.android"
    val playStationAppApplicationId: ApplicationId get() = "com.playstation.mobile"
    val playStationApplicationId: ApplicationId get() = "com.scee.psxandroid"
    val playStationMobile2ndScreen: ApplicationId get() = "com.playstation.mobile2ndscreen"
    val playStationRemotePlayApplicationId: ApplicationId get() = "com.playstation.remoteplay"
    val pocketApplicationId: ApplicationId get() = "com.ideashower.readitlater.pro"
    val poeApplicationId: ApplicationId get() = "com.poe.android"
    val protonMailApplicationId: ApplicationId get() = "ch.protonmail.android"
    val redditApplicationId: ApplicationId get() = "com.reddit.frontpage"
    val signalApplicationId: ApplicationId get() = "org.thoughtcrime.securesms"
    val slackApplicationId: ApplicationId get() = "com.Slack"
    val snapchatApplicationId: ApplicationId get() = "com.snapchat.android"
    val spotifyApplicationId: ApplicationId get() = "com.spotify.music"
    val startpageApplicationId: ApplicationId get() = "com.startpage.app"
    val steamApplicationId: ApplicationId get() = "com.valvesoftware.android.steam.community"
    val steamChatApplicationId: ApplicationId get() = "com.valvesoftware.android.steam.community.chat"
    val steamLinkApplicationId: ApplicationId get() = "com.valvesoftware.android.steam.link"
    val switchBotApplicationId: ApplicationId get() = "com.theswitchbot.switchbot"
    val systemSettingsApplicationId: ApplicationId get() = "com.android.settings"
    val telegramApplicationId: ApplicationId get() = "org.telegram.messenger"
    val telegramXApplicationId: ApplicationId get() = "org.thunderdog.challegram"
    val tiktokApplicationId: ApplicationId get() = "com.zhiliaoapp.musically"
    val twitterApplicationId: ApplicationId get() = "com.twitter.android"
    val whatsappApplicationId: ApplicationId get() = "com.whatsapp"
    val xboxApplicationId: ApplicationId get() = "com.microsoft.xboxone.smartglass"
    val xboxBetaApplicationId: ApplicationId get() = "com.microsoft.xboxone.smartglass.beta"
    val xboxFamilyApplicationId: ApplicationId get() = "com.microsoft.xboxfamily"
    val yahooMailApplicationId: ApplicationId get() = "com.yahoo.mobile.client.android.mail"
    val youTubeApplicationId: ApplicationId get() = "com.google.android.youtube"
    val youTubeKidsApplicationId: ApplicationId get() = "com.google.android.apps.youtube.kids"
    val youTubeMusicApplicationId: ApplicationId get() = "com.google.android.apps.youtube.music"
    val zoomApplicationId: ApplicationId get() = "us.zoom.videomeetings"

    val gameAmongUsApplicationId: ApplicationId get() = "com.innersloth.spacemafia"
    val gameAngryBirdsApplicationId: ApplicationId get() = "com.rovio.angrybirdsnote"
    val gameCallOfDutyApplicationId: ApplicationId get() = "com.activision.callofduty.shooter"
    val gameCandyCrushSagaApplicationId: ApplicationId get() = "com.king.candycrushsaga"
    val gameClashOfClansApplicationId: ApplicationId get() = "com.supercell.clashofclans"
    val gameClashOfKingsApplicationId: ApplicationId get() = "com.elex.clashofkings"
    val gameClashRoyaleApplicationId: ApplicationId get() = "com.supercell.clashroyale"
    val gameCoinMasterApplicationId: ApplicationId get() = "com.moonfrog.coinmaster"
    val gameFortniteApplicationId: ApplicationId get() = "com.epicgames.fortnite"
    val gameFreeFireApplicationId: ApplicationId get() = "com.dts.freefiremax"
    val gameGardenscapesApplicationId: ApplicationId get() = "com.playrix.gardenscapes"
    val gameGenshinImpactApplicationId: ApplicationId get() = "com.miHoYo.GenshinImpact"
    val gameHomescapesApplicationId: ApplicationId get() = "com.playrix.homescapes"
    val gameLordsMobileApplicationId: ApplicationId get() = "com.igg.android.lordsmobile"
    val gameMarioKartTourApplicationId: ApplicationId get() = "com.nintendo.zaka"
    val gameMarioRunApplicationId: ApplicationId get() = "com.nintendo.zara"
    val gameFireEmblemHeroesApplicationId: ApplicationId get() = "com.nintendo.zmhe"
    val gameMinecraftApplicationId: ApplicationId get() = "com.mojang.minecraftpe"
    val gamePubGApplicationId: ApplicationId get() = "com.tencent.ig"
    val gameRobloxApplicationId: ApplicationId get() = "com.roblox.client"
    val gameSubwaySurfersApplicationId: ApplicationId get() = "com.kiloo.subwaysurf"
    val gameTempleRun2ApplicationId: ApplicationId get() = "com.imangi.templerun2"
    val gameTempleRunApplicationId: ApplicationId get() = "com.imangi.templerun"
}
