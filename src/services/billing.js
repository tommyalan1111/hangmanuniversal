/*
 * Google Play Billing / StoreKit for the one-time "Remove Ads" product.
 *
 * The product must exist in Play Console as an in-app product (not a
 * subscription) with the ID below, and be Active before testing.
 */
(function () {
  'use strict';

  var PRODUCT_ID = 'remove_ads';
  var plugin = null;
  var product = null;
  var button = null;
  var purchasing = false;

  function getPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativePurchases) || null;
  }

  function isRemoved() {
    return !!(window.HangmanAds && window.HangmanAds.isRemoved());
  }

  function hideButton() {
    if (button) button.style.display = 'none';
  }

  function label() {
    return product && product.priceString ? 'Remove Ads · ' + product.priceString : 'Remove Ads';
  }

  function setBusy(busy) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Processing…' : label();
  }

  function notify(message) {
    if (window.HangmanApp && typeof window.HangmanApp.toast === 'function') {
      window.HangmanApp.toast(message);
    } else {
      console.log('[billing]', message);
    }
  }

  function owned(purchase) {
    if (!purchase || purchase.productIdentifier !== PRODUCT_ID) return false;
    // Android reports purchaseState "1" for a completed purchase. iOS does not
    // always send this field for non-consumables, so accept a missing value.
    return purchase.purchaseState == null || String(purchase.purchaseState) === '1';
  }

  function grant(showToast) {
    if (isRemoved() && !showToast) {
      hideButton();
      return;
    }
    if (window.HangmanAds) {
      window.HangmanAds.setRemoved(true);
      window.HangmanAds.hideBanner();
    }
    hideButton();
    if (showToast) notify('Ads removed. Thank you!');
  }

  async function restore() {
    if (!plugin) return false;
    try {
      var result = await plugin.getPurchases({ productType: 'inapp' });
      var purchases = (result && result.purchases) || [];
      for (var i = 0; i < purchases.length; i++) {
        if (owned(purchases[i])) {
          grant(false);
          return true;
        }
      }
    } catch (e) {
      console.warn('Billing restore error:', e);
    }
    return false;
  }

  async function loadProduct() {
    try {
      var result = await plugin.getProduct({
        productIdentifier: PRODUCT_ID,
        productType: 'inapp'
      });
      product = result && result.product;
    } catch (e) {
      console.warn('Billing product error:', e);
      product = null;
    }

    if (!product) {
      // Product missing/inactive in Play Console, or billing is unavailable.
      hideButton();
      return false;
    }

    if (button) {
      button.style.display = '';
      button.disabled = false;
      button.textContent = label();
    }
    return true;
  }

  async function init() {
    if (isRemoved()) {
      hideButton();
      return;
    }

    plugin = getPlugin();
    if (!plugin) {
      // Browser/dev build: no billing, so do not show a dead button.
      hideButton();
      return;
    }

    try {
      var support = await plugin.isBillingSupported();
      if (!support || !support.isBillingSupported) {
        hideButton();
        return;
      }
    } catch (e) {
      console.warn('Billing not supported:', e);
      hideButton();
      return;
    }

    var hasProduct = await loadProduct();
    if (!hasProduct) return;

    // Restore a previous purchase after reinstall / on a new device.
    await restore();
  }

  async function purchase() {
    if (purchasing || !plugin || !product) return;
    purchasing = true;
    setBusy(true);

    try {
      var transaction = await plugin.purchaseProduct({
        productIdentifier: PRODUCT_ID,
        productType: 'inapp',
        isConsumable: false
      });

      if (!transaction) throw new Error('No transaction returned');
      if (transaction.purchaseState != null && String(transaction.purchaseState) !== '1') {
        throw new Error('Purchase state ' + transaction.purchaseState);
      }

      // The plugin acknowledges/finishes the purchase by default. For stronger
      // security, validate transaction.purchaseToken on your backend before
      // calling grant().
      grant(true);
    } catch (e) {
      var message = String((e && (e.message || e.errorMessage || e.code)) || e);
      console.error('Purchase error:', e);

      if (/cancel/i.test(message)) {
        notify('Purchase cancelled');
      } else if (/already|owned/i.test(message)) {
        await restore();
        notify('Purchase restored');
      } else {
        notify('Could not complete the purchase');
      }
    } finally {
      purchasing = false;
      if (button && !isRemoved()) setBusy(false);
    }
  }

  function attach(btn) {
    if (!btn) return;
    button = btn;
    button.disabled = true;
    button.addEventListener('click', purchase);
    if (isRemoved()) hideButton();
  }

  window.HangmanBilling = {
    init: init,
    attach: attach,
    restore: restore,
    getPriceLabel: function () { return label(); }
  };
})();
