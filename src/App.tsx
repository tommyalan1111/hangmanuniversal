import React, { useEffect } from 'react';
import { adService } from './services/admob';

export default function App() {
  useEffect(() => {
    adService.init().then(() => {
      adService.showBanner();
    });
  }, []);

  return (
    <div className="app-container">
      {/* Các màn hình game của anh */}
    </div>
  );
}
