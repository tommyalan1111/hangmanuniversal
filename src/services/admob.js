(function () {
  'use strict';

  var AD_STATE_KEY = 'hangman-universal:no-ads';
  var LEVEL_COUNT_KEY = 'hangman-universal:level-count';

  /*
   * Real ad unit IDs. The application ID lives in AndroidManifest.xml /
   * Info.plist and must belong to the same AdMob account.
   */
  var BANNER_AD_ID = 'ca-app-pub-1345063149639557/6723912675';
  var INTERSTITIAL_AD_ID = 'ca-app-pub-1345063149639557/1925067474';
  var REWARDED_AD_ID = 'ca-app-pub-1345063149639557/8946092191';

  // Keep the WebView content above the native banner. The AdMob banner is a
  // native view drawn on top of the WebView, so only CSS padding can move the
  // game out from under it.
  var FALLBACK_BANNER_HEIGHT = 56;
  var bannerListenersReady = false;
  var bannerWanted = false;
  var bannerLoading = false;
  var bannerLoaded = false;
  var bannerRetryTimer = null;
  var bannerRetryDelay = 5000;

  function adsPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) || null;
  }

  function isAdsRemoved() {
    try {
      return localStorage.getItem(AD_STATE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setBannerSpace(height) {
    var h = Math.max(0, Number(height) || 0);
    document.documentElement.style.setProperty('--ad-banner-height', h + 'px');
    document.body.classList.toggle('has-banner', h > 0);
  }

  async function initAdMob() {
    if (isAdsRemoved()) return false;
    var AdMob = adsPlugin();
    if (!AdMob) return false;
    try {
      await AdMob.initialize({
        requestTrackingAuthorization: true,
        initializeForTesting: false
      });
      return true;
    } catch (e) {
      console.error('AdMob init error:', e);
      return false;
    }
  }

  function clearBannerRetry() {
    if (bannerRetryTimer) {
      window.clearTimeout(bannerRetryTimer);
      bannerRetryTimer = null;
    }
  }

  function scheduleBannerRetry(immediate) {
    if (!bannerWanted || bannerLoaded || isAdsRemoved() || !adsPlugin()) return;
    clearBannerRetry();
    var delay = immediate ? 1000 : bannerRetryDelay;
    bannerRetryDelay = Math.min(bannerRetryDelay * 2, 60000);
    bannerRetryTimer = window.setTimeout(function () {
      bannerRetryTimer = null;
      if (bannerWanted && !bannerLoaded) showBanner();
    }, delay);
  }

  function retryBannerNow() {
    if (!bannerWanted || bannerLoaded || bannerLoading) return;
    bannerRetryDelay = 5000;
    clearBannerRetry();
    showBanner();
  }

  function attachBannerListeners(AdMob) {
    if (bannerListenersReady) return;
    bannerListenersReady = true;

    AdMob.addListener('bannerAdSizeChanged', function (size) {
      setBannerSpace(size && size.height);
    }).catch(function (e) { console.warn('Banner size listener error:', e); });

    AdMob.addListener('bannerAdLoaded', function () {
      bannerLoaded = true;
      bannerRetryDelay = 5000;
      clearBannerRetry();
    }).catch(function (e) { console.warn('Banner loaded listener error:', e); });

    AdMob.addListener('bannerAdFailedToLoad', function () {
      bannerLoaded = false;
      setBannerSpace(0);
      scheduleBannerRetry();
    }).catch(function (e) { console.warn('Banner failed listener error:', e); });

    // Recover when connectivity comes back or the app returns to foreground.
    window.addEventListener('online', retryBannerNow);
    window.addEventListener('offline', function () {
      bannerLoaded = false;
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) retryBannerNow();
    });
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('resume', retryBannerNow);
    }
  }

  /* 1. Banner at the bottom of every screen */
  async function showBanner() {
    bannerWanted = true;
    if (isAdsRemoved()) {
      bannerWanted = false;
      return false;
    }
    var AdMob = adsPlugin();
    if (!AdMob) return false;
    if (bannerLoading) return false;

    bannerLoading = true;
    try {
      attachBannerListeners(AdMob);

      await AdMob.showBanner({
        adId: BANNER_AD_ID,
        position: 'BOTTOM_CENTER',
        // Full-width anchored banner. "size" is not a valid option and is
        // silently ignored by the plugin.
        adSize: 'ADAPTIVE_BANNER',
        margin: 0,
        isTesting: false
      });

      // hideBanner()/setRemoved() may have run while the native call was
      // in flight; do not reserve space for a banner that is no longer wanted.
      if (!bannerWanted || isAdsRemoved()) {
        setBannerSpace(0);
        return false;
      }

      // Reserve the space right away; the size event above refines it once the
      // SDK reports the real banner height (0 removes the gap again).
      setBannerSpace(FALLBACK_BANNER_HEIGHT);
      return true;
    } catch (e) {
      console.error('Show banner error:', e);
      setBannerSpace(0);
      scheduleBannerRetry();
      return false;
    } finally {
      bannerLoading = false;
    }
  }

  async function hideBanner() {
    bannerWanted = false;
    bannerLoaded = false;
    clearBannerRetry();
    var AdMob = adsPlugin();
    try {
      if (AdMob) await AdMob.hideBanner();
    } catch (e) {
      console.error('Hide banner error:', e);
    }
    setBannerSpace(0);
  }

  /* 2. Interstitial after every 3 completed levels */
  async function showInterstitialAfterThreeLevels() {
    if (isAdsRemoved()) return;

    var count = 0;
    try {
      count = parseInt(localStorage.getItem(LEVEL_COUNT_KEY) || '0', 10) + 1;
      localStorage.setItem(LEVEL_COUNT_KEY, count >= 3 ? '0' : String(count));
    } catch (e) {
      return;
    }
    if (count < 3) return;

    var AdMob = adsPlugin();
    if (!AdMob) return;

    try {
      await AdMob.prepareInterstitial({
        adId: INTERSTITIAL_AD_ID,
        isTesting: false
      });
      await AdMob.showInterstitial();
    } catch (e) {
      console.error('Show interstitial error:', e);
    }
  }

  /* 3. Remove ads state */
  function setAdsRemoved(purchased) {
    try {
      localStorage.setItem(AD_STATE_KEY, purchased ? 'true' : 'false');
    } catch (e) {
      /* private mode */
    }
    if (purchased) hideBanner();
  }

  /*
   * 4. Rewarded ad. Resolves true only when the player actually earned the
   * reward, false when they dismissed the video early or the ad failed.
   */
  async function showRewardedAd() {
    var AdMob = adsPlugin();
    if (!AdMob) {
      // Plain browser/dev build: no native SDK, let the flow be tested.
      return true;
    }

    return new Promise(function (resolve) {
      var settled = false;
      var handles = [];

      function finish(earned) {
        if (settled) return;
        settled = true;
        handles.forEach(function (handle) {
          try { handle.remove(); } catch (e) { /* already gone */ }
        });
        resolve(earned);
      }

      (async function () {
        try {
          handles.push(await AdMob.addListener('onRewardedVideoAdReward', function () {
            finish(true);
          }));
          handles.push(await AdMob.addListener('onRewardedVideoAdDismissed', function () {
            finish(false);
          }));
          handles.push(await AdMob.addListener('onRewardedVideoAdFailedToShow', function () {
            finish(false);
          }));

          await AdMob.prepareRewardVideoAd({
            adId: REWARDED_AD_ID,
            isTesting: false
          });

          // Do not await this promise: the native plugin only resolves it when
          // a reward is earned, so dismissing early would leave it pending.
          AdMob.showRewardVideoAd().catch(function (e) {
            console.error('Show rewarded ad error:', e);
            finish(false);
          });
        } catch (e) {
          console.error('Prepare rewarded ad error:', e);
          finish(false);
        }
      })();
    });
  }

  window.HangmanAds = {
    init: initAdMob,
    showBanner: showBanner,
    hideBanner: hideBanner,
    checkInterstitial: showInterstitialAfterThreeLevels,
    showRewarded: showRewardedAd,
    setRemoved: setAdsRemoved,
    isRemoved: isAdsRemoved
  };
})();
