(function () {
  'use strict';

  var AD_STATE_KEY = 'hangman-universal:no-ads';

  function isAdsRemoved() {
    try {
      return localStorage.getItem(AD_STATE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  async function initAdMob() {
    if (isAdsRemoved()) return;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
        var AdMob = window.Capacitor.Plugins.AdMob;
        await AdMob.initialize({
          requestTrackingAuthorization: true,
          initializeForTesting: true,
        });
      }
    } catch (e) {
      console.error('AdMob init error:', e);
    }
  }

  // 1. Hiển thị Banner ở mép dưới
  async function showBanner() {
    if (isAdsRemoved()) return;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
        var AdMob = window.Capacitor.Plugins.AdMob;
        await AdMob.showBanner({
          adId: 'ca-app-pub-3940256099942544/6300978111', // Test Banner ID
          position: 'BOTTOM_CENTER',
          size: 'BANNER',
          margin: 0,
          reload: true
        });
      }
    } catch (e) {
      console.error('Show banner error:', e);
    }
  }

  async function hideBanner() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
        await window.Capacitor.Plugins.AdMob.hideBanner();
      }
    } catch (e) {
      console.error('Hide banner error:', e);
    }
  }

  // 2. Interstitial Ad sau mỗi 3 màn chơi
  async function showInterstitialAfterThreeLevels() {
    if (isAdsRemoved()) return;

    try {
      var countKey = 'hangman-universal:level-count';
      var currentCount = parseInt(localStorage.getItem(countKey) || '0', 10) + 1;

      if (currentCount >= 3) {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
          var AdMob = window.Capacitor.Plugins.AdMob;
          await AdMob.prepareInterstitial({
            adId: 'ca-app-pub-3940256099942544/1033173712', // Test Interstitial ID
            isTesting: true
          });
          await AdMob.showInterstitial();
        }
        localStorage.setItem(countKey, '0');
      } else {
        localStorage.setItem(countKey, currentCount.toString());
      }
    } catch (e) {
      console.error('Show interstitial error:', e);
    }
  }

  // 3. Mua gói Remove Ads ($1.99)
  function setAdsRemoved(purchased) {
    try {
      localStorage.setItem(AD_STATE_KEY, purchased ? 'true' : 'false');
      if (purchased) {
        hideBanner();
      }
    } catch (e) {}
  }

  window.HangmanAds = {
    init: initAdMob,
    showBanner: showBanner,
    hideBanner: hideBanner,
    checkInterstitial: showInterstitialAfterThreeLevels,
    setRemoved: setAdsRemoved,
    isRemoved: isAdsRemoved
  };
})();
