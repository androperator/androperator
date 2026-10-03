package androperator.apps

import action.system.model.ApplicationId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

class KnownAppsRepositoryDefault : KnownAppsRepository {
    override val browserApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.brave.browser",
                "com.android.chrome",
                "com.android.browser",
                "com.opera.browser",
                "com.microsoft.emmx",
                "org.mozilla.firefox",
                "com.duckduckgo.mobile.android",
                "com.vivaldi.browser",
                "com.yandex.browser",
                "com.maxthon.browser",
                "com.ghostery.android.ghostery",
                "com.sec.android.app.sbrowser",
                "com.huawei.browser",
                "com.opera.mini.native",
                "com.opera.gx",
                "com.kiwibrowser.browser",
                "org.mozilla.focus",
                "com.ecosia.android",
            ),
        )

    override val calendarApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.calendar",
                "com.samsung.android.calendar",
                "com.microsoft.office.outlook",
                "com.simplemobiletools.calendar.pro",
                "com.microsoft.teams",
                "net.fortuna.android.caldavsync",
                "com.apple.ical",
                "com.anydo.cal",
                "com.proton.android.calendar",
                "com.appgenix.bizcal",
            ),
        )

    override val cameraApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.GoogleCamera",
                "com.android.camera",
                "com.android.camera2",
                "com.sec.android.app.camera",
                "com.oneplus.camera",
                "com.huawei.camera",
                "com.sonyericsson.android.camera",
                "com.motorola.camera",
                "com.oppo.camera",
                "com.vivo.camera",
                "com.xiaomi.camera",
                "com.asus.camera",
                "com.footej.camera2",
                "com.instagram.android",
                "com.snapchat.android",
                "com.adobe.photoshop.camera",
                "com.filmic.filmicpro",
                "com.moment.pro.camera",
                "com.promobitech.opencamera",
                "net.sourceforge.opencamera",
                "com.simplemobiletools.camera",
                "com.duapps.camera",
                "com.lightbox.android.camera",
            ),
        )

    override val chatBotApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                chatGptApplicationId,
                claudeApplicationId,
                deepSeekApplicationId,
                googleGeminiApplicationId,
                grokApplicationId,
                manusAi,
                metaAi,
                microsoftCopilot,
                mistralApplicationId,
                perplexityApplicationId,
                poeApplicationId,
            ),
        )

    override val chromeApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                chromeApplicationId,
                chromeBetaApplicationId,
                chromeCanaryApplicationId,
                chromeDevApplicationId,
            ),
        )

    override val cryptoApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                binanceApplicationId,
                binanceUsApplicationId,
                coinbaseApplicationId,
                coinbaseWalletApplicationId,
                krakenApplicationId,
            ),
        )

    override val galleryApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.apps.photos",
                "com.sec.android.gallery3d",
                "com.android.gallery3d",
                "com.simplemobiletools.gallery.pro",
                "com.alensw.PicFolder",
                "com.amazon.photos",
                "com.dropbox.android",
                "com.google.android.apps.photosgo",
                "com.oneplus.gallery",
                "com.miui.gallery",
                "com.vivo.gallery",
                "com.oppo.gallery3d",
            ),
        )

    override val gameApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                gameAmongUsApplicationId,
                gameAngryBirdsApplicationId,
                gameCallOfDutyApplicationId,
                gameCandyCrushSagaApplicationId,
                gameClashOfClansApplicationId,
                gameClashOfKingsApplicationId,
                gameClashRoyaleApplicationId,
                gameCoinMasterApplicationId,
                gameFireEmblemHeroesApplicationId,
                gameFortniteApplicationId,
                gameFreeFireApplicationId,
                gameGardenscapesApplicationId,
                gameGardenscapesApplicationId,
                gameGenshinImpactApplicationId,
                gameHomescapesApplicationId,
                gameLordsMobileApplicationId,
                gameMarioKartTourApplicationId,
                gameMarioRunApplicationId,
                gameMinecraftApplicationId,
                gamePubGApplicationId,
                gameRobloxApplicationId,
                gameSubwaySurfersApplicationId,
                gameTempleRun2ApplicationId,
                gameTempleRunApplicationId,
            ),
        )

    override val gamingApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                googleGamesApplicationId,
                nintendoSwitchApplicationId,
                nintendoSwitchParentControlsApplicationId,
                playStationAppApplicationId,
                playStationApplicationId,
                playStationMobile2ndScreen,
                playStationRemotePlayApplicationId,
                steamApplicationId,
                steamChatApplicationId,
                steamLinkApplicationId,
                xboxApplicationId,
                xboxBetaApplicationId,
                xboxFamilyApplicationId,
            ),
        )

    override val mapsApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.apps.maps",
                "com.google.android.apps.mapslite",
                "com.waze",
                "com.here.app.maps",
                "net.osmand",
                "net.osmand.plus",
                "com.mapquest.android.ace",
                "com.sygic.aura",
                "com.tomtom.gplay.navapp",
                "com.citymapper.app.release",
                "me.lyft.android",
                "com.ubercab",
                "org.maps.me",
            ),
        )

    override val musicApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.music",
                "com.spotify.music",
                "com.pandora.android",
                "com.soundcloud.android",
                "com.apple.android.music",
                "com.amazon.mp3",
                "com.google.android.apps.youtube.music",
                "fm.player",
                "com.tidal.wave",
                "deezer.android.app",
            ),
        )

    // Podcasts, music, and radio apps
    override val audioApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.music",
                "com.spotify.music",
                "com.pandora.android",
                "com.soundcloud.android",
                "com.apple.android.music",
                "com.amazon.mp3",
                "com.google.android.apps.youtube.music",
                "fm.player",
                "com.audible.application",
                "com.google.android.apps.podcasts",
                "com.tidal.wave",
                "deezer.android.app",
                "au.com.shiftyjelly.pocketcasts",
            ),
        )

    // Social networking apps - NOTE this is "social" apps, not "messaging" apps
    override val socialApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.facebook.katana",
                "com.facebook.orca",
                "com.facebook.lite",
                "com.instagram.android",
                "com.snapchat.android",
                "com.twitter.android",
                "com.linkedin.android",
                "com.pinterest",
                "com.reddit.frontpage",
                "com.tumblr",
                "com.tiktok.musical.ly",
                "com.zhiliaoapp.musically",
                "com.vkontakte.android",
            ),
        )

    // Messaging apps (SMS, MMS, and chat apps)
    override val messagingApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.apps.messaging", // Google Messages
                "com.samsung.android.messaging", // Samsung Messages
                "com.oneplus.mms", // OnePlus Messages
                "com.motorola.messaging", // Motorola Messaging
                "com.sonyericsson.conversations", // Sony Messaging
                "com.lge.message", // LG Messaging
                "com.htc.sense.message", // HTC Messaging
                "com.asus.message", // ASUS Messaging
                "com.miui.mms", // Xiaomi Messaging
                "com.huawei.message", // Huawei Messaging
                "com.oppo.messaging", // OPPO Messaging
                "com.vivo.messaging", // Vivo Messaging
                "com.whatsapp",
                "com.facebook.orca",
                "com.facebook.lite",
                "org.telegram.messenger",
                "com.viber.voip",
                "com.skype.raider",
                "com.discord",
                "jp.naver.line.android",
                "com.kakao.talk",
                "com.tencent.mm",
                "com.signal.messenger",
                "com.threema.app",
            ),
        )

    override val newsApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.apps.magazines",
                "com.nytimes.android",
                "com.washingtonpost.android",
                "com.cnn.mobile.android.phone",
                "com.foxnews.android",
                "com.reuters.reutersmobile",
                "com.bloomberg.android",
                "com.guardian",
                "com.zumobi.msnbc",
                "com.abc.abcnews",
                "com.bbcnews.android",
                "com.apnews.android",
                "com.npr.android",
                "com.apple.news",
                "com.flipboard",
                "com.medium.reader",
                "com.feedly.android",
                "com.opera.news",
                "com.microsoft.amp.apps.bingnews",
                "com.yahoo.mobile.client.android.yahoo",
                "com.smartnews.android",
                "net.aljazeera.english",
                "com.dailymail.online",
                "com.economist.lamarr",
            ),
        )

    override val productivityApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.microsoft.office.word",
                "com.microsoft.office.excel",
                "com.microsoft.office.powerpoint",
                "com.microsoft.office.onenote",
                "com.microsoft.office.outlook",
                "com.google.android.apps.docs",
                "com.google.android.apps.sheets",
                "com.google.android.apps.slides",
                "com.google.android.keep",
                "com.google.android.apps.tasks",
                "com.google.android.apps.meetings",
                "com.google.android.apps.classroom",
                "com.todoist",
                "com.any.do",
                "com.evernote",
                "com.dropbox.android",
                "com.box.android",
                "com.notion.android",
                "com.trello",
                "com.asana.app",
                "com.slack",
                "com.microsoft.teams",
                "com.adobe.reader",
                "com.microsoft.lens",
            ),
        )

    override val searchEndpointApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                googleSearchApplicationId,
                bingApplicationId,
                braveApplicationId,
                duckDuckGoApplicationId,
                startpageApplicationId,
                amazonApplicationId,
                googleMapsApplicationId,
                googlePlayApplicationId,
                netflixApplicationId,
                redditApplicationId,
                spotifyApplicationId,
                youTubeApplicationId,
                youTubeMusicApplicationId,
            ),
        )

    // Video streaming apps (Netflix, Hulu, YouTube, etc.)
    override val videoApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.netflix.mediaclient",
                "com.hulu.plus",
                "com.google.android.youtube",
                "com.amazon.avod.thirdpartyclient",
                "com.disney.disneyplus",
                "com.plexapp.android",
                "com.hbo.hbonow",
                "com.cbs.app",
                "com.peacocktv.peacockandroid",
                "com.crunchyroll.crunchyroid",
                "com.vimeo.android.videoapp",
                "tv.twitch.android.app",
                "com.apple.atve.androidtv",
            ),
        )

    override val shoppingApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.amazon.mShop.android.shopping",
                "com.ebay.mobile",
                "com.etsy.android",
                "com.walmart.android",
                "com.alibaba.intl.android.apps.poseidon",
                "com.zappos.android",
                "com.target.ui",
                "com.wish",
                "com.newegg.app",
                "com.overstock",
                "com.costco.app.android",
                "com.bestbuy.android",
                "com.homedepot",
                "com.lowes.android",
                "com.wayfair.wayfair",
                "com.ikea.android",
                "com.temu.android",
                "com.shopee.android",
                "com.shein.shein",
                "com.mercari",
                "com.offerup",
                "com.groupon",
                "com.rakuten.android",
                "com.aliexpress.android",
            ),
        )

    override val emailApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.gm",
                "com.microsoft.office.outlook",
                "com.yahoo.mobile.client.android.mail",
                "com.google.android.apps.inbox",
                "com.samsung.android.email.provider",
                "com.cloudmagic.mail",
                "me.proton.mail",
                "com.fsck.k9",
                "com.readdle.spark",
                "com.my.mail",
            ),
        )

    override val phoneApplicationIds: Flow<List<ApplicationId>> =
        flowOf(
            listOf(
                "com.google.android.dialer",
                "com.android.dialer",
                "com.samsung.android.dialer",
                "com.google.android.apps.googlevoice",
                "com.truecaller",
                "com.whatsapp",
                "com.skype.raider",
                "com.viber.voip",
                "com.imo.android.imoim",
                "com.microsoft.teams",
                "com.zoom.videomeetings",
                "us.zoom.videomeetings",
                "com.cisco.webex.meetings",
                "com.google.android.apps.tachyon",
            ),
        )
}
