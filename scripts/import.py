import urllib.request
import urllib.parse
import json
import csv
import re

def generate_sport_questions():
    # Truy vấn SPARQL từ Wikidata: Lấy các đội bóng thuộc Premier League (Q9448)
    query = """
    SELECT ?teamLabel ?stadiumLabel ?capacity WHERE {
      ?team wdt:P118 wd:Q9448;          # Thuộc giải đấu Premier League (Q9448)
            wdt:P115 ?stadium.          # Có sân nhà
      ?stadium wdt:P1083 ?capacity.     # Lấy sức chứa của sân
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?capacity)
    LIMIT 30
    """
    
    # Mã hóa câu query vào URL và yêu cầu trả về định dạng JSON
    url = "https://query.wikidata.org/sparql?query=" + urllib.parse.quote(query) + "&format=json"
    
    # Wikidata yêu cầu User-Agent rõ ràng
    headers = {
        'User-Agent': 'HangmanQuestionGenerator/1.0 (tommyalan1111; Automation QA)'
    }
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            # Wikidata bọc dữ liệu trong mảng bindings
            results = data['results']['bindings']
    except Exception as e:
        print("Lỗi khi gọi API Wikidata:", e)
        return

    questions = []
    
    for item in results:
        # Bóc tách dữ liệu từ file JSON của Wikidata
        team_name = item.get('teamLabel', {}).get('value', '')
        stadium = item.get('stadiumLabel', {}).get('value', '')
        capacity_str = item.get('capacity', {}).get('value', '0')
        capacity = int(capacity_str) if capacity_str.isdigit() else 0
        
        # Tiền xử lý Answer cho game Hangman
        answer = team_name.upper().replace(' FC', '').replace(' F.C.', '')
        answer = re.sub(r'[^A-Z ]', '', answer)
        answer = re.sub(r'\s+', ' ', answer).strip()
        
        # Bỏ qua nếu đáp án vi phạm luật độ dài
        if len(answer) < 2 or len(answer) > 16:
            continue
            
        question = f"Which football club plays their home matches at {stadium}?"
        
        # Auto-Difficulty Scoring
        if capacity > 50000:
            difficulty = 1
        elif capacity > 30000:
            difficulty = 2
        else:
            difficulty = 3
            
        questions.append(['sport', question, answer, difficulty])
        
        if len(questions) == 20:
            break

    with open('sport_questions.csv', 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['category', 'question', 'answer', 'difficulty'])
        writer.writerows(questions)
        
    print(f"Đã tạo thành công {len(questions)} câu hỏi từ Wikidata và lưu vào sport_questions.csv")

if __name__ == "__main__":
    generate_sport_questions()
