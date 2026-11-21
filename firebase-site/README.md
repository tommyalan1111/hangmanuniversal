# Hangman Universal — website

Trang giới thiệu **Hangman Universal** (game hangman cho Android), deploy trên
Firebase Hosting. Site tĩnh: không framework, không build step, không backend.

- **Site:** https://hangman-universal-site.web.app
- **Firebase project:** `hangman-universal-site`
- **Nội dung:** 21 chủ đề, 14.351 câu hỏi, 6 mạng
- **Package Android:** `com.hangmanuniversal.game`

## Cấu trúc

```
firebase-site/
├── firebase.json              # hosting: public/, cleanUrls, redirects, cache headers
├── .firebaserc                # project mặc định
├── public/
│   ├── index.html             # trang giới thiệu (hero, 3 feature card, quote, footer)
│   ├── site.css               # toàn bộ giao diện
│   ├── 404.html
│   ├── favicon.svg
│   ├── icon.png               # icon app 512px
│   ├── apple-touch-icon.png
│   ├── og.jpg                 # ảnh chia sẻ 1200×630
│   ├── screenshots/           # ảnh app dạng WebP
│   ├── robots.txt
│   ├── app-ads.txt            # xác minh AdMob (pub-1345063149639557)
│   └── sitemap.xml
└── tools/
    ├── serve.mjs              # server tĩnh để xem thử
    ├── preview.mjs            # chụp ảnh + kiểm tra bằng Chrome headless
    └── make-assets.py         # sinh icon, screenshot WebP, og.jpg
```

## Xem thử trên máy

```powershell
cd firebase-site
node tools/serve.mjs            # http://127.0.0.1:4173
```

`serve.mjs` mô phỏng đường dẫn của Firebase Hosting: `index.html` cho `/`,
`/trang` → `trang.html`, và trả `404.html` cho đường dẫn sai.

Chụp ảnh + kiểm tra tự động (cần Chrome):

```powershell
node tools/preview.mjs          # ảnh trong .shots/
```

Script kiểm tra ảnh hỏng, tràn ngang, lỗi console và in kích thước trang ở
desktop 1440px + mobile 390px.

## Cập nhật ảnh / icon

```powershell
python tools/make-assets.py
```

Nguồn ảnh:

- `../store/play-icon-512.png` — icon
- `../.shots/01-home.png`, `02-play.png` — screenshot

Script cần Pillow. Nếu máy không có, dùng Python bundled của DSH hoặc
`pip install pillow`.

## Số liệu hiển thị

Các con số **14.351 clues**, **21 topics**, **6 lives** đang viết tay trong
`public/index.html` (hero, facts, meta description, JSON-LD) và trong
`tools/make-assets.py` (ảnh OG). Khi ngân hàng câu hỏi thay đổi, chạy
`node tools/validate.mjs` ở repo root để lấy số mới rồi cập nhật:

1. `public/index.html` — facts, meta description, card “21 topics”
2. `tools/make-assets.py` — dòng chữ trong `save_og()`
3. `public/sitemap.xml` — cập nhật `lastmod`

## Nút Google Play

Nút “Get it on Google Play” trỏ tới:

```
https://play.google.com/store/apps/details?id=com.hangmanuniversal.game
```

App chưa publish thì Play Store trả 404. Khi app lên store, link tự hoạt động.
Nếu muốn đổi thành “Coming soon” (không link) hoặc domain/store khác, sửa 2 chỗ
trong `index.html` (hero + footer).

## Deploy

```powershell
cd firebase-site
npx firebase-tools@latest deploy --only hosting
```

Nếu đã cài Firebase CLI toàn cục thì `firebase deploy --only hosting` là đủ.
Project đã có trong `.firebaserc`.

Kiểm tra sau deploy:

```powershell
curl.exe -I https://hangman-universal-site.web.app/
curl.exe -I https://hangman-universal-site.web.app/privacy/
```

`/privacy` và `/privacy/` được redirect 301 sang Google Sites (xem
`firebase.json`), nên link cũ vẫn dùng được.

## Ghi chú

- **Chính sách riêng tư nằm ở Google Sites:**
  https://sites.google.com/view/hangmanuniversal-privacypolicy/home
  Các link Privacy trên trang đều trỏ thẳng tới đây; `/privacy` và `/privacy/`
  được redirect 301 sang cùng địa chỉ.
- **Không có analytics, cookie hay quảng cáo trên website.** App Android dùng
  AdMob + Play Billing; chính sách riêng tư (Google Sites) mô tả cả hai. Nếu
  thêm analytics/ads vào web, phải cập nhật policy trước.
- `app-ads.txt` ở root dùng publisher ID `pub-1345063149639557` (cùng tài khoản
  AdMob với app). Khi đặt “website” cho app trong Play Console, dùng domain này
  để Google xác minh.
- Link support trong footer trỏ tới GitHub issues của repo.
- Ảnh screenshot là ảnh app thật, không phải mockup.
- Cache: ảnh/font 7 ngày, JS/CSS 1 giờ. HTML luôn được kiểm tra lại.
- Custom domain: thêm trong Firebase Console → Hosting → Add custom domain,
  sau đó cập nhật `canonical`, `og:url`, `sitemap.xml` và `robots.txt`.

## Lịch sử

- 21/11/2026 — tạo Firebase project, trang giới thiệu, deploy hosting; đổi
  policy sang Google Sites và thêm redirect `/privacy`.
