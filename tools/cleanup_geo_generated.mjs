import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Trỏ chính xác vào file của DeepSeek sinh ra
const bankPath = path.join(here, '..', 'data', 'questions.generated.js');

console.log('Đang đọc file dữ liệu: ' + bankPath);
const source = fs.readFileSync(bankPath, 'utf8');

const lines = source.split('\n');
const cleanLines = [];
const geoAnswerCount = new Map();

let geoKept = 0;
let geoRemoved = 0;
const MAX_DUPLICATE_ANSWER = 2; // Cho phép một đáp án quốc gia/thành phố xuất hiện tối đa 2 lần
const MAX_TOTAL_GEO = 400;      // Tổng số câu geo giữ lại tối đa

for (const line of lines) {
  // Dùng Regex tìm chuỗi data nằm trong ngoặc kép hoặc ngoặc đơn có chứa 3 dấu gạch đứng "|"
  const match = line.match(/(['"])([^'"]+\|[^'"]+\|[^'"]+\|[^'"]+)\1/);
  
  if (!match) {
    // Không phải dòng chứa câu hỏi (có thể là dòng khai báo array, ngoặc đóng...), giữ nguyên
    cleanLines.push(line);
    continue;
  }

  const content = match[2]; // Lấy nội dung data bên trong
  const parts = content.split('|');
  const category = parts[0].trim();
  const answer = parts[2].trim().toUpperCase();

  // Logic lọc riêng cho category 'geo'
  if (category === 'geo') {
    const count = geoAnswerCount.get(answer) || 0;
    
    // Nếu đáp án chưa lặp quá 2 lần VÀ tổng câu geo chưa vượt giới hạn -> Giữ lại
    if (count < MAX_DUPLICATE_ANSWER && geoKept < MAX_TOTAL_GEO) {
      geoAnswerCount.set(answer, count + 1);
      cleanLines.push(line);
      geoKept++;
    } else {
      geoRemoved++; // Xóa bỏ dòng thừa
    }
  } else {
    // Các category khác (nếu có trong file này) thì giữ nguyên 100%
    cleanLines.push(line);
  }
}

// Tạo file backup trước khi ghi đè để bảo toàn tính mạng cho data
const backupPath = path.join(here, '..', 'data', `questions.generated.backup_${Date.now()}.js`);
fs.copyFileSync(bankPath, backupPath);

// Ghi đè file mới với dữ liệu đã được thanh lọc
fs.writeFileSync(bankPath, cleanLines.join('\n'));

console.log('\n--- KẾT QUẢ DỌN DẸP FILE GENERATED ---');
console.log(`Đã giữ lại: ${geoKept} câu Địa lý (geo)`);
console.log(`Đã XÓA BỎ:  ${geoRemoved} câu Địa lý lặp trùng/thừa thãi`);
console.log(`File backup an toàn: data/questions.generated.backup_${Date.now()}.js`);
