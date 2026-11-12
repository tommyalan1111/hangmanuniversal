import { AdMob, BannerAdPosition, BannerAdSize, RewardAdReward, InterstitialAdPluginEvents } from '@capacitor-community/admob';

class AdService {
  private isAdsRemoved(): boolean {
    return localStorage.getItem('remove_ads_purchased') === 'true';
  }

  async init() {
    try {
      await AdMob.initialize({
        requestTrackingAuthorization: true,
        initializeForTesting: true,
      });
    } catch (e) {
      console.error('AdMob init error:', e);
    }
  }

  // --- 1. BANNER: Hiển thị ở mép dưới tất cả màn hình ---
  async showBanner() {
    if (this.isAdsRemoved()) return;
    try {
      await AdMob.showBanner({
        adId: 'ca-app-pub-3940256099942544/6300978111', // Test Banner ID
        position: BannerAdPosition.BOTTOM_CENTER,
        size: BannerAdSize.BANNER,
        margin: 0,
        reload: true
      });
    } catch (e) {
      console.error('Show banner error:', e);
    }
  }

  async hideBanner() {
    try {
      await AdMob.hideBanner();
    } catch (e) {
      console.error('Hide banner error:', e);
    }
  }

  // --- 2. INTERSTITIAL: Hiện sau khi chơi liên tiếp 3 màn ---
  async showInterstitialAfterThreeLevels() {
    if (this.isAdsRemoved()) return;

    // Tăng biến đếm số màn đã chơi trong localStorage
    let completedCount = parseInt(localStorage.getItem('completed_levels_count') || '0', 10) + 1;
    
    if (completedCount >= 3) {
      try {
        await AdMob.prepareInterstitial({
          adId: 'ca-app-pub-3940256099942544/1033173712', // Test Interstitial ID
          isTesting: true
        });
        await AdMob.showInterstitial();
        // Reset lại biến đếm sau khi hiện ad
        localStorage.setItem('completed_levels_count', '0');
      } catch (e) {
        console.error('Show interstitial error:', e);
      }
    } else {
      localStorage.setItem('completed_levels_count', completedCount.toString());
    }
  }

  // --- 3. IN-APP PURCHASE: Remove Ads $1.99 ---
  setAdsRemoved(status: boolean) {
    localStorage.setItem('remove_ads_purchased', status.toString());
    if (status) {
      this.hideBanner();
    }
  }
}

export const adService = new AdService();
