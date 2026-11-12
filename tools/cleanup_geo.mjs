import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bankPath = path.join(here, '..', 'data', 'questions.js');

console.log('Đang đọc file dữ liệu: ' + bankPath);
const source = fs.readFileSync(bankPath, 'utf8');

const rawStart = source.indexOf('var CURATED = [');
const rawEnd = source.indexOf('\n  ];', rawStart);

if (rawStart === -1 || rawEnd === -1) {
  console.error('Lỗi: Không tìm thấy mảng CURATED trong data/questions.js');
  process.exit(1);
}

// Cắt file ra làm 3 khúc: Đầu - Giữa (chứa data) - Cuối
const head = source.slice(0, rawStart + 'var CURATED = ['.length);
const tail = source.slice(rawEnd);
const middle = source.slice(rawStart + 'var CURATED = ['.length, rawEnd);

const lines = middle.split('\n');
const cleanLines = [];
const geoAnswerCount = new Map();

let geoKept = 0;
let geoRemoved = 0;
const MAX_DUPLICATE_ANSWER = 2; // Cho phép một quốc gia xuất hiện tối đa 2 lần
const MAX_TOTAL_GEO = 400;      // Tổng số câu Địa lý giữ lại

for (const line of lines) {
  const trimmed = line.trim();
  
  // Giữ lại các dòng trống hoặc comment
  if (!trimmed.startsWith("'")) {
    cleanLines.push(line);
    continue;
  }

  // Bóc tách nội dung câu hỏi
  const match = trimmed.match(/^'(.+)',?$/);
  if (!match) {
    cleanLines.push(line);
    continue;
  }

  const content = match[1].replace(/\\'/g, "'");
  const parts = content.split('|');
  const category = parts[0];
  const answer = parts[2];

  // Logic lọc riêng cho category 'geo'
  if (category === 'geo') {
    const ansUpper = answer.toUpperCase();
    const count = geoAnswerCount.get(ansUpper) || 0;
    
    if (count < MAX_DUPLICATE_ANSWER && geoKept < MAX_TOTAL_GEO) {
      geoAnswerCount.set(ansUpper, count + 1);
      cleanLines.push(line);
      geoKept++;
    } else {
      geoRemoved++; // Xóa bỏ câu thừa
    }
  } else {
    // Các category khác giữ nguyên không đụng tới
    cleanLines.push(line);
  }
}

// Backup file cũ trước khi ghi đè (phòng hờ)
const backupPath = path.join(here, '..', 'data', `questions_backup_${Date.now()}.js`);
fs.copyFileSync(bankPath, backupPath);

// Ghi đè file mới
const newSource = head + cleanLines.join('\n') + tail;
fs.writeFileSync(bankPath, newSource);

console.log('\n--- KẾT QUẢ DỌN DẸP ---');
console.log(`Đã giữ lại: ${geoKept} câu Địa lý (geo)`);
console.log(`Đã XÓA BỎ:  ${geoRemoved} câu Địa lý lặp trùng/thừa thãi`);
console.log(`File backup an toàn: data/questions_backup_${Date.now()}.js`);
